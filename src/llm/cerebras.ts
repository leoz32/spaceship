import { getModelProfile, getSettings, validateProfile, type ModelProfile, type ModelRole } from "./settings.ts"
import { postModelRequest, requestError, requestSignal } from "./transport.ts"

export const KEY_STORAGE = "cerebras-api-key"
export const storedApiKey = () => getModelProfile("generation").apiKey || undefined

export type CompletionRequest = {
  apiKey?: string
  role?: ModelRole
  system: string
  user: string
  temperature: number
  maxCompletionTokens: number
  signal: AbortSignal
  json?: boolean
  profile?: ModelProfile
  transport?: "proxy" | "direct"
}
export type ChatUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }
export type ChatResult = { content: string; usage: ChatUsage }

export async function* streamCompletion(request: CompletionRequest): AsyncGenerator<string> {
  request.signal.throwIfAborted()
  const profile = profileFor(request)
  const signal = requestSignal(request.signal)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let generated = false
  try {
    const response = await sendCompletion(profile, request, true, signal)
    if (response.headers.get("content-type")?.includes("application/json")) {
      const result = resultOf(await response.json())
      signal.throwIfAborted()
      if (!result.content.trim()) throw new Error("模型没有返回正文，请关闭深度思考或检查模型设置。")
      yield result.content
      return
    }
    if (!response.body) throw new Error("模型接口没有返回响应流。")
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let eventLines: string[] = []
    let ended = false
    const consumeLine = (line: string): string | undefined => {
      if (!line) {
        if (!eventLines.length) return
        const event = eventLines.join("\n")
        eventLines = []
        if (event.trim() === "[DONE]") {
          ended = true
          return
        }
        let data: unknown
        try {
          data = JSON.parse(event)
        } catch {
          throw new Error("模型返回了无法解析的流式数据，请确认使用 Chat Completions 兼容接口。")
        }
        return deltaOf(data)
      }
      if (line.startsWith("data:")) eventLines.push(line.slice(5).replace(/^ /, ""))
      return
    }
    while (!ended) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (done && buffer.endsWith("\r")) buffer += "\n"
      while (true) {
        const separator = /\r\n|\n|\r/.exec(buffer)
        if (!separator || (separator[0] === "\r" && separator.index === buffer.length - 1 && !done)) break
        const line = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const content = consumeLine(line)
        signal.throwIfAborted()
        if (content) {
          generated ||= Boolean(content.trim())
          yield content
        }
        if (ended) break
      }
      if (done && !ended) {
        if (buffer) consumeLine(buffer)
        const content = consumeLine("")
        signal.throwIfAborted()
        if (content) {
          generated ||= Boolean(content.trim())
          yield content
        }
        break
      }
    }
    if (!generated) throw new Error("模型没有返回正文，请关闭深度思考或检查模型设置。")
  } catch (error) {
    throw requestError(error, request.signal)
  } finally {
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}

export async function completeChat(request: CompletionRequest): Promise<ChatResult> {
  request.signal.throwIfAborted()
  const profile = profileFor(request)
  const signal = requestSignal(request.signal)
  try {
    const response = await sendCompletion(profile, request, false, signal)
    const result = resultOf(await response.json())
    signal.throwIfAborted()
    if (!result.content.trim()) throw new Error("模型返回空内容，请调整分析模型或关闭强制 JSON 模式后重试。")
    return result
  } catch (error) {
    throw requestError(error, request.signal)
  }
}

export function completionUrl(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, "")
  return url.endsWith("/chat/completions") ? url : `${url}/chat/completions`
}

export function completionBody(profile: ModelProfile, request: CompletionRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: profile.model,
    stream,
    temperature: profile.provider === "zhipu" ? Math.min(1, Math.max(0, request.temperature)) : request.temperature,
    [profile.provider === "cerebras" ? "max_completion_tokens" : "max_tokens"]: request.maxCompletionTokens,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  }
  if (profile.fastMode) {
    if (["deepseek", "doubao", "zhipu"].includes(profile.provider)) body.thinking = { type: "disabled" }
    if (["qwen", "siliconflow"].includes(profile.provider)) body.enable_thinking = false
    if (profile.provider === "cerebras") body.reasoning_effort = "low"
  }
  if (request.json && profile.jsonMode) body.response_format = { type: "json_object" }
  return body
}

function profileFor(request: CompletionRequest): ModelProfile {
  const profile = { ...(request.profile ?? getModelProfile(request.role ?? "generation")) }
  if (request.apiKey !== undefined) profile.apiKey = request.apiKey.trim()
  const errors = validateProfile(profile)
  if (errors.length) throw new Error(errors.join(" "))
  return profile
}

function sendCompletion(profile: ModelProfile, request: CompletionRequest, stream: boolean, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {}
  if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`
  return postModelRequest(
    completionUrl(profile.baseUrl),
    headers,
    completionBody(profile, request, stream),
    signal,
    request.transport ?? getSettings().transport,
  )
}

function deltaOf(value: unknown): string | undefined {
  if (!isRecord(value)) throw new Error("模型返回了无效的流式数据。")
  if (value.error) throw new Error("模型在生成过程中返回错误，请检查模型权限或额度。")
  const choices = value.choices
  if (!Array.isArray(choices) || !choices.length) return
  const first = choices[0]
  if (!isRecord(first)) return
  if (first.finish_reason === "length") throw new Error("模型输出达到长度上限，结果可能不完整；请换用非思考模型或减少分析内容。")
  if (first.finish_reason === "content_filter") throw new Error("模型服务未返回该内容，请调整故事后重试。")
  const delta = first.delta
  return isRecord(delta) && typeof delta.content === "string" ? delta.content : undefined
}

function resultOf(value: unknown): ChatResult {
  if (!isRecord(value) || value.error || !Array.isArray(value.choices) || !value.choices.length) throw new Error("模型返回了无效的 Chat Completions 响应。")
  const choice = value.choices[0]
  const content = isRecord(choice) && isRecord(choice.message) && typeof choice.message.content === "string" ? choice.message.content : ""
  if (isRecord(choice) && choice.finish_reason === "length") throw new Error("模型输出达到长度上限，结果可能不完整；请换用非思考模型或减少分析内容。")
  const usage = isRecord(value.usage) ? value.usage : {}
  return {
    content,
    usage: {
      prompt_tokens: countOf(usage.prompt_tokens),
      completion_tokens: countOf(usage.completion_tokens),
      total_tokens: countOf(usage.total_tokens),
    },
  }
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
