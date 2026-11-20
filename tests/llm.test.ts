import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { completeChat, completionBody, completionUrl, streamCompletion, type CompletionRequest } from "../src/llm/cerebras.ts"
import { probeModel } from "../src/llm/chat.ts"
import { createDecisions, parseDecisionAnswers, type Question } from "../src/llm/decisions.ts"
import { getProvider, PROVIDERS } from "../src/llm/providers.ts"
import { clearStoredKeys, getModelProfile, getSettings, saveSettings, validateSettings, type AppSettings } from "../src/llm/settings.ts"
import { isRetryableError } from "../src/llm/transport.ts"

const originalFetch = globalThis.fetch
const originalLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
const originalSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage")
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location")

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true })
  Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), configurable: true })
  Object.defineProperty(globalThis, "location", { value: { origin: "http://localhost:5173" }, configurable: true })
  const settings = getSettings()
  settings.generation.apiKey = "test-private-key"
  settings.transport = "direct"
  saveSettings(settings)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, descriptor] of [
    ["localStorage", originalLocal],
    ["sessionStorage", originalSession],
    ["location", originalLocation],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

test("defaults use compatible analysis, proxy and session-only credentials", () => {
  localStorage.clear()
  sessionStorage.clear()
  const settings = getSettings()
  assert.equal(settings.generation.provider, "deepseek")
  assert.equal(settings.generation.model, "deepseek-flash")
  assert.equal(settings.decisionBackend, "compatible")
  assert.equal(settings.transport, "proxy")
  assert.equal(settings.analysisUsesGeneration, true)
  assert.equal(settings.rememberKeys, false)
  settings.generation.apiKey = "a-secret"
  saveSettings(settings)
  assert.equal(getSettings().generation.apiKey, "a-secret")
  assert.ok(!storageValues(localStorage).includes("a-secret"))
  assert.ok(storageValues(sessionStorage).includes("a-secret"))
})

test("remember toggle moves secrets and clear keeps model configuration", () => {
  const settings = getSettings()
  settings.rememberKeys = true
  settings.generation.model = "my-model"
  saveSettings(settings)
  assert.ok(storageValues(localStorage).includes("test-private-key"))
  assert.ok(!storageValues(sessionStorage).includes("test-private-key"))
  settings.rememberKeys = false
  saveSettings(settings)
  assert.ok(!storageValues(localStorage).includes("test-private-key"))
  clearStoredKeys()
  assert.equal(getSettings().generation.apiKey, "")
  assert.equal(getSettings().generation.model, "my-model")
})

test("a different tab cannot bind this tab's session key to a new provider or URL", async () => {
  const saved = JSON.parse(localStorage.getItem("spaceship-settings-v1")!)
  saved.generation.provider = "qwen"
  saved.generation.baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"
  localStorage.setItem("spaceship-settings-v1", JSON.stringify(saved))
  assert.equal(getSettings().generation.apiKey, "")
  let called = false
  globalThis.fetch = async () => {
    called = true
    return jsonResponse("不应调用")
  }
  await assert.rejects(collect(streamCompletion(request())), /API Key/)
  assert.equal(called, false)
  saved.generation.provider = "deepseek"
  saved.generation.baseUrl = "https://unrelated.example/v1"
  localStorage.setItem("spaceship-settings-v1", JSON.stringify(saved))
  assert.equal(getSettings().generation.apiKey, "")
  saved.generation.baseUrl = "https://api.deepseek.com"
  saved.generation.model = "another-model-on-the-same-endpoint"
  localStorage.setItem("spaceship-settings-v1", JSON.stringify(saved))
  assert.equal(getSettings().generation.apiKey, "test-private-key")
})

test("unavailable session storage never silently falls back to persistent keys", () => {
  const settings = getSettings()
  const session = memoryStorage()
  session.setItem = () => {
    throw new DOMException("blocked", "QuotaExceededError")
  }
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true })
  assert.throws(() => saveSettings(settings))
  assert.ok(!storageValues(localStorage).includes("test-private-key"))
})

test("legacy keys migrate once into session storage", () => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem("cerebras-api-key", "old-key")
  localStorage.setItem("gemini-api-key", "old-google")
  const settings = getSettings()
  assert.equal(settings.generation.provider, "cerebras")
  assert.equal(settings.generation.apiKey, "old-key")
  assert.equal(settings.geminiApiKey, "old-google")
  assert.equal(settings.decisionBackend, "gemini")
  assert.equal(localStorage.getItem("cerebras-api-key"), null)
  assert.ok(!storageValues(localStorage).includes("old-key"))
})

test("validation rejects credentials, query strings and unsupported protocols in URLs", () => {
  for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com?key=secret", "https://example.com#key", "ftp://example.com"]) {
    const settings = getSettings()
    settings.generation.baseUrl = url
    assert.ok(validateSettings(settings).length)
  }
  const settings = getSettings()
  settings.analysisUsesGeneration = false
  settings.analysis.apiKey = "analysis-key"
  settings.analysis.model = "analysis-model"
  saveSettings(settings)
  assert.equal(getModelProfile("analysis").apiKey, "analysis-key")
  assert.equal(getModelProfile("generation").apiKey, "test-private-key")
})

test("provider parameters are scoped and fast mode is optional", () => {
  for (const provider of PROVIDERS) {
    const profile = { ...getSettings().generation, provider: provider.id, model: provider.model, baseUrl: provider.baseUrl }
    const fast = completionBody(profile, request(), true)
    const normal = completionBody({ ...profile, fastMode: false }, request(), true)
    assert.ok(!("thinking" in normal))
    assert.ok(!("enable_thinking" in normal))
    assert.ok(!("reasoning_effort" in normal))
    if (provider.id === "cerebras") assert.equal(fast.max_completion_tokens, 64)
    else assert.equal(fast.max_tokens, 64)
    if (provider.id === "custom") assert.ok(!("thinking" in fast))
  }
  const glm = completionBody({ ...getSettings().generation, provider: "zhipu" }, { ...request(), temperature: 1.5 }, false)
  assert.equal(glm.temperature, 1)
  assert.equal(completionUrl("https://example.com/v1/"), "https://example.com/v1/chat/completions")
  assert.equal(completionUrl("https://example.com/v1/chat/completions/"), "https://example.com/v1/chat/completions")
  assert.equal(getProvider("missing").id, "deepseek")
})

test("SSE handles UTF-8 splits, split CRLF, comments, reasoning and final unframed content", async () => {
  const text = [
    ": heartbeat\r\n\r\n",
    'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"中文"}}]}\r\n\r\n',
    'data: {"choices":[],"usage":{"total_tokens":1}}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"故事"},"finish_reason":"stop"}]}',
  ].join("")
  globalThis.fetch = async () => streamResponse(text, 1)
  assert.equal(await collect(streamCompletion(request())), "中文故事")
})

test("SSE stops at DONE and cancels unread response data", async () => {
  let cancelled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n'))
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    )
  assert.equal(await collect(streamCompletion(request())), "好")
  assert.ok(cancelled)
})

test("SSE supports multiline event data and rejects malformed or empty output", async () => {
  globalThis.fetch = async () => streamResponse('data: {"choices":\ndata: [{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n')
  assert.equal(await collect(streamCompletion(request())), "好")
  globalThis.fetch = async () => streamResponse("data: not-json\n\n")
  await assert.rejects(collect(streamCompletion(request())), /无法解析/)
  globalThis.fetch = async () => streamResponse('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\ndata: [DONE]\n\n')
  await assert.rejects(collect(streamCompletion(request())), /没有返回正文/)
})

test("token-limit truncation is not reported as a successful completion", async () => {
  let cancelled = false
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"未完成"},"finish_reason":"length"}]}\n\n'))
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    )
  await assert.rejects(collect(streamCompletion(request())), /长度上限/)
  assert.ok(cancelled)
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"partial":true}' }, finish_reason: "length" }] }), {
      headers: { "Content-Type": "application/json" },
    })
  await assert.rejects(completeChat(request()), /长度上限/)
})

test("invalid JSON errors cannot echo a key contained in a provider response", async () => {
  globalThis.fetch = async () => new Response("test-private-key: invalid JSON", { headers: { "Content-Type": "application/json" } })
  await assert.rejects(completeChat(request()), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.ok(!error.message.includes("test-private-key"))
    assert.ok(error.message.includes("有效 JSON"))
    return true
  })
})

test("streaming accepts a provider's JSON fallback; empty JSON is rejected", async () => {
  globalThis.fetch = async () => jsonResponse("回退正文")
  assert.equal(await collect(streamCompletion(request())), "回退正文")
  globalThis.fetch = async () => jsonResponse("   ")
  await assert.rejects(completeChat(request()), /空内容/)
})

test("abort before dispatch and during generation never yields stale text", async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return streamResponse("")
  }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(collect(streamCompletion({ ...request(), signal: controller.signal })), { name: "AbortError" })
  assert.equal(called, false)
  const active = new AbortController()
  globalThis.fetch = async () => streamResponse('data: {"choices":[{"delta":{"content":"一"}}]}\n\ndata: {"choices":[{"delta":{"content":"二"}}]}\n\n')
  const stream = streamCompletion({ ...request(), signal: active.signal })
  assert.equal((await stream.next()).value, "一")
  active.abort()
  await assert.rejects(stream.next(), { name: "AbortError" })
})

test("proxy envelopes credentials without putting them in the URL", async () => {
  const settings = getSettings()
  settings.transport = "proxy"
  saveSettings(settings)
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://localhost:5173/api/llm")
    const envelope = JSON.parse(String(init?.body))
    assert.equal(envelope.url, "https://api.deepseek.com/chat/completions")
    assert.equal(envelope.headers.Authorization, "Bearer test-private-key")
    assert.equal(envelope.body.stream, false)
    assert.equal(init?.redirect, "error")
    return jsonResponse("成功")
  }
  assert.equal((await completeChat(request())).content, "成功")
})

test("HTTP errors redact credentials and preserve status; no automatic retry", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(JSON.stringify({ error: { message: "test-private-key limit" } }), { status: 429 })
  }
  await assert.rejects(completeChat(request()), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.ok(!error.message.includes("test-private-key"))
    assert.ok(error.message.includes("429"))
    assert.ok(isRetryableError(error))
    return true
  })
  assert.equal(calls, 1)
})

test("a plan without Provider API access is reported distinctly and is not retried", async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response(JSON.stringify({ error: { code: "upgrade_required", message: "API access requires an eligible plan." } }), { status: 403 })
  }
  await assert.rejects(completeChat(request()), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /套餐未开通 Provider API/)
    assert.equal(isRetryableError(error), false)
    return true
  })
  assert.equal(calls, 1)
})

test("probe uses unsaved profile with streaming without touching stored credentials", async () => {
  const before = storageValues(localStorage) + storageValues(sessionStorage)
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://example.com/v1/chat/completions")
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer unsaved-secret")
    assert.equal(JSON.parse(String(init?.body)).stream, true)
    return streamResponse('data: {"choices":[{"delta":{"content":"连接成功"}}]}\n\ndata: [DONE]\n\n')
  }
  const result = await probeModel(
    { ...getSettings().generation, provider: "custom", baseUrl: "https://example.com/v1", model: "candidate", apiKey: "unsaved-secret" },
    "direct",
    new AbortController().signal,
  )
  assert.equal(result.sample, "连接成功")
  assert.ok(result.firstChunkMs >= 0)
  assert.equal(storageValues(localStorage) + storageValues(sessionStorage), before)
})

test("decision validation rejects bad scores, missing IDs and invented options", () => {
  const questions: Record<string, Question> = {
    s: { type: "score", instructions: "评分", criteria: ["低", "中", "高"] },
    n: { type: "noul", instructions: "符合" },
    c: { type: "choice", instructions: "选择", criteria: { a: "一", b: "二" } },
  }
  const valid = { answers: { s: { type: "score", score: 1.5 }, n: { type: "noul", noul: 0.6 }, c: { type: "choice", choice: "a" } } }
  const parsed = parseDecisionAnswers(valid, questions)
  assert.deepEqual(parsed.s.type === "score" && parsed.s.probabilities, {})
  assert.equal(parsed.s.confidence, 0)
  for (const invalid of [
    { answers: { ...valid.answers, s: { type: "score", score: "2" } } },
    { answers: { ...valid.answers, s: { type: "score", score: 10 } } },
    { answers: { ...valid.answers, n: { type: "noul", noul: -1 } } },
    { answers: { ...valid.answers, c: { type: "choice", choice: "invented" } } },
    { answers: {} },
  ])
    assert.throws(() => parseDecisionAnswers(invalid, questions))
})

test("compatible decisions batch eight questions and aggregate actual usage", async () => {
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.stream, false)
    assert.deepEqual(body.response_format, { type: "json_object" })
    const questions = JSON.parse(body.messages[1].content).questions
    assert.ok(Object.keys(questions).length <= 8)
    return jsonResponse(JSON.stringify({ answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.75 }])) }), {
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
    })
  }
  const questions = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`q${i}`, { type: "noul" as const, instructions: "符合吗" }]))
  const result = await createDecisions(undefined, { model: "ignored-native-model", input: "故事", questions }, new AbortController().signal)
  assert.equal(calls, 2)
  assert.equal(Object.keys(result.answers).length, 10)
  assert.equal(result.source, "model-estimate")
  assert.equal(result.usage.total_tokens, 28)
})

test("decision queue is serial and cancellation removes a queued call", async () => {
  let calls = 0
  let finishFirst!: () => void
  globalThis.fetch = async () => {
    calls++
    if (calls === 1)
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
    return jsonResponse('{"answers":{"q":{"type":"noul","noul":0.5}}}')
  }
  const input = { model: "ignored", input: "故事", questions: { q: { type: "noul" as const, instructions: "符合吗" } } }
  const first = createDecisions(undefined, input, new AbortController().signal)
  await new Promise((resolve) => setImmediate(resolve))
  const abort = new AbortController()
  const second = createDecisions(undefined, input, abort.signal)
  const third = createDecisions(undefined, input, new AbortController().signal)
  abort.abort()
  await assert.rejects(second, { name: "AbortError" })
  assert.equal(calls, 1)
  finishFirst()
  await Promise.all([first, third])
  assert.equal(calls, 2)
})

test("native Gemini backend uses its own credential and preserves native probabilities", async () => {
  const settings: AppSettings = getSettings()
  settings.decisionBackend = "gemini"
  settings.geminiApiKey = "google-secret"
  saveSettings(settings)
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/decisions")
    assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], "google-secret")
    return new Response(
      JSON.stringify({
        answers: { q: { type: "score", score: 0.4, confidence: 0.8, probabilities: { "0": 0.6, "1": 0.4 } } },
        usage: { total_input_tokens: 5, total_output_tokens: 0, total_tokens: 5 },
      }),
      { headers: { "Content-Type": "application/json" } },
    )
  }
  const result = await createDecisions(
    undefined,
    { model: "gemini-decision-1", input: "故事", questions: { q: { type: "score", instructions: "评分", criteria: ["低", "高"] } } },
    new AbortController().signal,
  )
  assert.equal(result.source, "native-decision")
  assert.deepEqual(result.answers.q.type === "score" && result.answers.q.probabilities, { "0": 0.6, "1": 0.4 })
})

function request(): CompletionRequest {
  return { system: "测试", user: "你好", temperature: 0.4, maxCompletionTokens: 64, signal: new AbortController().signal }
}

function streamResponse(text: string, chunkSize = 17): Response {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
        controller.close()
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

function jsonResponse(content: string, usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage }), {
    headers: { "Content-Type": "application/json" },
  })
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let value = ""
  for await (const chunk of stream) value += chunk
  return value
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value))
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
  }
}

function storageValues(storage: Storage): string {
  return Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index)!)).join("\n")
}
