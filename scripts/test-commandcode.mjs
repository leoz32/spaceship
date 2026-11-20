#!/usr/bin/env node
import { emitKeypressEvents } from "node:readline"

const BASE_URL = "https://api.commandcode.ai/provider/v1"
const COMPLETION_URL = `${BASE_URL}/chat/completions`
const TIMEOUT_MS = 30_000
const flags = new Set(process.argv.slice(2))
const allowedFlags = new Set(["--help", "-h", "--smoke", "--nonstream"])

if (flags.has("--help") || flags.has("-h")) {
  console.log(`CommandCode 小额兼容测试（Node.js 24+）

用法：
  node scripts/test-commandcode.mjs --smoke
  node scripts/test-commandcode.mjs
  CMD_MODEL=deepseek/deepseek-v4-flash node scripts/test-commandcode.mjs --smoke

选项：
  --smoke       只做一次连接测试，最多 256 个输出 token。
  --nonstream   将第一轮改为非流式 completeChat；不会增加请求次数。
  --help, -h    显示帮助，不读取密钥，不发请求。

默认执行：一次中文流式续写（最多 512 输出 token），成功后再执行一次
真实 createDecisions 兼容分析（2 个小问题，最多 600 输出 token）。
每次最多等待 30 秒，遇错立即停止，不重试。

接口固定为 ${BASE_URL}，禁止重定向。
模型由 CMD_MODEL 指定，默认 deepseek/deepseek-v4-flash。
优先读取 CMD_API_KEY；未设置时，在终端隐藏输入，不回显、不写入文件。
仅使用进程内存保存设置。实际 token 以服务返回的 usage 为准；未返回就
标为“未提供”，不估算。stream_options.include_usage 用于请求流式用量。
fastMode=false，jsonMode=true；不会自动增加思考参数或切换模型。
默认深度思考的模型可能耗尽这次小额输出预算，脚本会停止。`)
} else if ([...flags].some((flag) => !allowedFlags.has(flag))) {
  console.error("参数无效。请运行 node scripts/test-commandcode.mjs --help 查看用法。")
  process.exitCode = 2
} else if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("此测试需要 Node.js 24 或更新版本。")
  process.exitCode = 2
} else {
  await main()
}

async function main() {
  let apiKey = ""
  let profile
  let active
  let originalFetch
  let restoreStorage = () => {}
  const local = memoryStorage()
  const session = memoryStorage()
  const smoke = flags.has("--smoke")
  const nonstream = flags.has("--nonstream")
  const model = (process.env.CMD_MODEL || "deepseek/deepseek-v4-flash").trim()
  if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(model)) {
    console.error("CMD_MODEL 应为模型 ID，例如 deepseek/deepseek-v4-flash。")
    process.exitCode = 2
    return
  }

  try {
    apiKey = (process.env.CMD_API_KEY || "").trim() || (await readHiddenKey())
    if (!apiKey || /[\r\n]/.test(apiKey)) throw ownError("configuration")
    restoreStorage = installMemoryStorage(local, session)
    const [{ streamCompletion, completeChat }, { createDecisions }, { getSettings, saveSettings }] = await Promise.all([
      import("../src/llm/cerebras.ts"),
      import("../src/llm/decisions.ts"),
      import("../src/llm/settings.ts"),
    ])
    profile = { provider: "commandcode", baseUrl: BASE_URL, model, apiKey, fastMode: false, jsonMode: true }
    saveSettings({
      ...getSettings(),
      generation: { ...profile },
      analysis: { ...profile },
      analysisUsesGeneration: true,
      decisionBackend: "compatible",
      geminiApiKey: "",
      rememberKeys: false,
      transport: "direct",
    })

    const fetchDirect = globalThis.fetch.bind(globalThis)
    originalFetch = globalThis.fetch
    let requests = 0
    globalThis.fetch = async (input, init = {}) => {
      const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (!active || target !== COMPLETION_URL || init.method !== "POST" || ++requests > (smoke ? 1 : 2)) throw ownError("destination")
      const report = active
      const body = JSON.parse(init.body)
      body.max_tokens = Math.min(report.tokenLimit, positiveInteger(body.max_tokens) ?? report.tokenLimit)
      if (body.max_completion_tokens !== undefined)
        body.max_completion_tokens = Math.min(report.tokenLimit, positiveInteger(body.max_completion_tokens) ?? report.tokenLimit)
      if (body.stream) body.stream_options = { include_usage: true }
      const response = await fetchDirect(COMPLETION_URL, {
        ...init,
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.any([init.signal, report.signal].filter(Boolean)),
      })
      report.status = response.status
      if (!response.ok) {
        const detail = await response
          .clone()
          .text()
          .catch(() => "")
        if (/error code:\s*1010\b/i.test(detail)) report.errorCode = "cloudflare_1010"
        else {
          try {
            const error = JSON.parse(detail).error
            const code = error?.code ?? error?.type
            if (
              [
                "authentication_error",
                "upgrade_required",
                "model_region_unavailable",
                "unsupported_model",
                "invalid_request_error",
                "rate_limit_error",
                "model_temporarily_unavailable",
                "upstream_unavailable",
                "server_error",
                "cmd_zdr_no_providers",
                "content_policy_refused",
                "upstream_refused",
              ].includes(code)
            )
              report.errorCode = code
          } catch {}
        }
      }
      if (response.ok && response.body) {
        const observer = response.clone()
        report.observation =
          body.stream && !response.headers.get("content-type")?.includes("application/json")
            ? observeStreamUsage(observer, report)
            : observeJsonUsage(observer, report)
      }
      return response
    }

    console.log(`接口：${BASE_URL}`)
    console.log(`模型：${safeText(model, apiKey)}`)
    console.log(smoke ? "将执行 1 次请求，输出上限 256 token。" : "将依次执行 2 次请求，输出上限分别为 512 和 600 token。")
    active = newReport(smoke ? "连接测试" : "中文续写", smoke ? 256 : 512)
    const request = {
      role: "generation",
      system: "请用简体中文直接回答。只输出正文，不输出分析、标题或 Markdown。",
      user: smoke ? "只回复：连接成功。" : "接着‘月光落在古堡门前，艾拉握紧钥匙。’续写一到两句话，控制在40个汉字以内。",
      temperature: 0.2,
      maxCompletionTokens: active.tokenLimit,
      signal: active.signal,
    }
    if (nonstream) {
      const result = await completeChat(request)
      active.sample = result.content.slice(0, 500)
      active.mode = "非流式"
    } else {
      for await (const chunk of streamCompletion(request)) {
        if (active.firstChunkMs === undefined && chunk.trim()) active.firstChunkMs = Math.round(performance.now() - active.started)
        active.sample = (active.sample + chunk).slice(0, 500)
      }
      active.mode = "流式"
    }
    if (!active.sample.trim()) throw ownError("empty")
    active.elapsedMs = Math.round(performance.now() - active.started)
    await active.observation
    printReport(active, apiKey, true)
    if (smoke) return

    active = newReport("兼容结构化分析", 600)
    active.mode = "createDecisions → completeChat"
    const result = await createDecisions(
      undefined,
      {
        model,
        input: "艾拉握紧钥匙，屏住呼吸。门后的脚步声越来越近，她伸手护住将要熄灭的烛火。",
        questions: {
          tension: { type: "score", instructions: "这段文字的紧张程度如何？", criteria: ["平静", "略有紧张", "明显紧张"] },
          character: { type: "choice", instructions: "这段文字主要描写谁？", criteria: { elara: "艾拉", guard: "守门人" } },
        },
      },
      active.signal,
    )
    active.elapsedMs = Math.round(performance.now() - active.started)
    active.sample = JSON.stringify(result.answers)
    await active.observation
    printReport(active, apiKey, true)
    console.log("两轮完成。分析数值是文本语义估计，不是模型内部注意力或校准概率。")
  } catch (error) {
    if (active) {
      active.elapsedMs = Math.round(performance.now() - active.started)
      await active.observation
      printReport(active, apiKey, false)
    }
    console.error(`测试已停止：${failureSummary(error, active)}`)
    process.exitCode = error?.testFailure === "cancelled" ? 130 : 1
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch
    local.clear()
    session.clear()
    restoreStorage()
    if (profile) profile.apiKey = ""
    apiKey = ""
  }
}

function newReport(name, tokenLimit) {
  return {
    name,
    tokenLimit,
    started: performance.now(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    status: undefined,
    firstChunkMs: undefined,
    elapsedMs: undefined,
    sample: "",
    usage: undefined,
    finishReason: undefined,
    observation: Promise.resolve(),
  }
}

function printReport(report, apiKey, success) {
  console.log(`\n${report.name}：${success ? "通过" : "失败"}`)
  console.log(`HTTP：${report.status ?? "未收到响应"}；耗时：${report.elapsedMs} ms${report.mode ? `；模式：${report.mode}` : ""}`)
  if (report.errorCode) console.log(`服务错误码：${report.errorCode}`)
  if (report.firstChunkMs !== undefined) console.log(`首段正文：${report.firstChunkMs} ms`)
  if (report.finishReason) console.log(`结束原因：${report.finishReason}`)
  if (report.sample) console.log(`样文：${safeText(report.sample, apiKey)}`)
  const usage = report.usage
  if (!usage) console.log("实际 token：服务未提供 usage，不估算。")
  else
    console.log(
      `实际 token：输入 ${usage.prompt ?? "未提供"}，输出 ${usage.completion ?? "未提供"}，合计 ${usage.total ?? "未提供"}${usage.reasoning === undefined ? "" : `，其中思考 ${usage.reasoning}`}`,
    )
}

async function observeJsonUsage(response, report) {
  try {
    captureUsage(await response.json(), report)
  } catch {
    // Usage collection does not alter the application's success/failure result.
  }
}

async function observeStreamUsage(response, report) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let lines = []
  let ended = false
  let bytes = 0
  const line = (value) => {
    if (value.startsWith("data:")) lines.push(value.slice(5).trimStart())
    if (value || !lines.length) return
    const data = lines.join("\n")
    lines = []
    if (data.trim() === "[DONE]") {
      ended = true
      return
    }
    try {
      captureUsage(JSON.parse(data), report)
    } catch {
      // The main application parser is responsible for protocol validation.
    }
  }
  try {
    while (!ended) {
      const { value, done } = await reader.read()
      bytes += value?.length ?? 0
      if (bytes > 1_048_576) break
      buffer += decoder.decode(value, { stream: !done })
      if (done && buffer.endsWith("\r")) buffer += "\n"
      while (true) {
        const separator = /\r\n|\n|\r/.exec(buffer)
        if (!separator || (separator[0] === "\r" && separator.index === buffer.length - 1 && !done)) break
        line(buffer.slice(0, separator.index))
        buffer = buffer.slice(separator.index + separator[0].length)
        if (ended) break
      }
      if (done) {
        if (buffer) line(buffer)
        line("")
        break
      }
    }
  } catch {
    // A timeout or cancellation may prevent the provider's final usage event.
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function captureUsage(value, report) {
  if (!value || typeof value !== "object") return
  const reason = value.choices?.[0]?.finish_reason
  if (["stop", "length", "content_filter", "tool_calls", "function_call"].includes(reason)) report.finishReason = reason
  const usage = value.usage
  if (!usage || typeof usage !== "object") return
  const checked = {
    prompt: tokenCount(usage.prompt_tokens ?? usage.input_tokens),
    completion: tokenCount(usage.completion_tokens ?? usage.output_tokens),
    total: tokenCount(usage.total_tokens),
    reasoning: tokenCount(usage.completion_tokens_details?.reasoning_tokens),
  }
  if (Object.values(checked).some((count) => count !== undefined)) report.usage = checked
}

function tokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function safeText(text, apiKey) {
  return String(text)
    .replaceAll(apiKey || "\u0000", "[密钥已隐藏]")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
}

function failureSummary(error, report) {
  if (error?.testFailure === "cancelled") return "已取消输入。"
  if (error?.testFailure === "no-tty") return "未设置 CMD_API_KEY，且当前不是可隐藏输入的终端。请在本机交互终端运行，或通过环境变量提供密钥。"
  if (error?.testFailure === "configuration") return "API Key 为空或格式无效。"
  if (error?.testFailure === "destination") return "触发接口地址或请求次数保护，未发送额外请求。"
  if (report?.errorCode === "upgrade_required") return "当前 Command Code 套餐未开通 Provider API 权限；未执行后续测试。"
  if (report?.errorCode === "cloudflare_1010") return "服务侧访问防护拦截了请求，请检查网络或联系服务方；未重试。"
  if (report?.status === 401 || report?.status === 403) return "接口拒绝访问，请检查密钥、模型权限或服务侧访问限制；未重试。"
  if (report?.status === 429) return "接口限流或额度不足；未重试。"
  if (report?.status && report.status >= 400) return `接口返回 HTTP ${report.status}，请核对模型名称及参数；未重试。`
  if (report?.signal.aborted || error?.name === "TimeoutError") return "单次请求超过 30 秒，已停止。"
  if (report?.finishReason === "length") return "触及小额测试的输出上限；结果可能不完整，未重试。"
  if (report?.finishReason === "content_filter") return "服务未返回该内容，未重试。"
  if (error?.testFailure === "empty") return "没有收到非空正文。"
  if (report?.status === 200) return "已收到 HTTP 200，但正文、JSON 或结构化结果不符合项目的协议校验；未重试。"
  return "未能完成请求，请检查 Node.js 版本、网络或服务状态。为避免泄露信息，不输出原始异常。"
}

function ownError(testFailure) {
  return Object.assign(new Error("CommandCode test stopped"), { testFailure })
}

function memoryStorage() {
  const values = new Map()
  return {
    get length() {
      return values.size
    },
    key(index) {
      return [...values.keys()][index] ?? null
    },
    getItem(key) {
      return values.get(String(key)) ?? null
    },
    setItem(key, value) {
      values.set(String(key), String(value))
    },
    removeItem(key) {
      values.delete(String(key))
    },
    clear() {
      values.clear()
    },
  }
}

function installMemoryStorage(local, session) {
  const originals = new Map(["localStorage", "sessionStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local })
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session })
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}

function readHiddenKey() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.reject(ownError("no-tty"))
  return new Promise((resolve, reject) => {
    const input = process.stdin
    const wasRaw = Boolean(input.isRaw)
    let secret = ""
    let finished = false
    const restore = () => {
      try {
        input.setRawMode(wasRaw)
      } catch {}
      input.pause()
    }
    const finish = (error) => {
      if (finished) return
      finished = true
      input.off("keypress", onKey)
      input.off("end", cancel)
      process.off("SIGINT", cancel)
      process.off("SIGTERM", cancel)
      process.off("exit", restore)
      restore()
      process.stdout.write("\n")
      const value = secret.trim()
      secret = ""
      if (error) reject(error)
      else resolve(value)
    }
    const cancel = () => finish(ownError("cancelled"))
    const onKey = (value, key = {}) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) return cancel()
      if (key.name === "return" || key.name === "enter") return finish()
      if (key.name === "backspace") {
        secret = secret.slice(0, -1)
        return
      }
      if (key.ctrl || key.meta || key.sequence?.startsWith("\u001b")) return
      if (value && /^[\x21-\x7e]+$/.test(value)) {
        if (secret.length + value.length > 4096) return finish(ownError("configuration"))
        secret += value
      }
    }
    process.stdout.write("CommandCode API Key（输入不显示）：")
    input.setRawMode(true)
    emitKeypressEvents(input)
    input.on("keypress", onKey)
    input.on("end", cancel)
    process.on("SIGINT", cancel)
    process.on("SIGTERM", cancel)
    process.on("exit", restore)
    input.resume()
  })
}
