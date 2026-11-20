import { once } from "node:events"

const DEFAULT_ORIGINS = [
  "https://api.deepseek.com",
  "https://dashscope.aliyuncs.com",
  "https://dashscope-intl.aliyuncs.com",
  "https://ark.cn-beijing.volces.com",
  "https://api.siliconflow.cn",
  "https://api.siliconflow.com",
  "https://open.bigmodel.cn",
  "https://api.commandcode.ai",
  "https://api.cerebras.ai",
  "https://generativelanguage.googleapis.com",
]
const MAX_BODY_BYTES = 1024 * 1024
const TIMEOUT_MS = 90_000
const FORWARDED_HEADERS = new Set(["authorization", "x-goog-api-key", "content-type"])

/** A personal, loopback-only proxy. Extra destinations must be explicitly allowed by the process owner. */
export function createLlmProxy({ allowedOrigins, timeoutMs = TIMEOUT_MS, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const customOrigins = allowedOrigins ?? (process.env.SPACESHIP_ALLOWED_ORIGINS ?? "").split(",").filter((value) => value.trim())
  const origins = new Set([...DEFAULT_ORIGINS, ...customOrigins.map(normalizeOrigin)])
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error("代理超时和请求大小上限必须为正数")
  }

  return async function llmProxy(request, response, next) {
    const pathname = (request.url ?? "").split("?")[0]
    if (pathname !== "/api/llm" && pathname !== "/api/health") return next()
    const controller = new AbortController()
    let reader
    let timedOut = false
    const cancel = () => {
      controller.abort()
      void reader?.cancel().catch(() => {})
    }
    const onClose = () => {
      if (!response.writableEnded) cancel()
    }
    const timer = setTimeout(() => {
      timedOut = true
      cancel()
    }, timeoutMs)
    timer.unref()
    request.once("aborted", cancel)
    response.once("close", onClose)

    try {
      validateLocalRequest(request)
      const expectedMethod = pathname === "/api/health" ? "GET" : "POST"
      if (request.method !== expectedMethod) {
        response.setHeader("allow", expectedMethod)
        throw requestError(405, "此接口不支持该请求方法", "method_not_allowed")
      }
      if (pathname === "/api/health") return sendJson(response, 200, { proxy: true })
      if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw requestError(415, "请使用 application/json 发送请求", "unsupported_content_type")
      }
      const payload = await readPayload(request, controller.signal, maxBodyBytes)
      const { url, headers, body } = validatePayload(payload, origins)
      const upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal, redirect: "manual" })
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel()
        throw requestError(502, "模型接口返回了重定向，请检查接口地址；代理不会跟随重定向", "redirect_blocked")
      }
      controller.signal.throwIfAborted()
      response.statusCode = upstream.status
      response.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8")
      response.setHeader("cache-control", "no-store")
      response.setHeader("x-content-type-options", "nosniff")
      response.setHeader("x-accel-buffering", "no")
      const retryAfter = upstream.headers.get("retry-after")
      if (retryAfter) response.setHeader("retry-after", retryAfter)
      if (!upstream.body) return response.end()
      reader = upstream.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        controller.signal.throwIfAborted()
        if (done) break
        if (!response.write(value)) await once(response, "drain", { signal: controller.signal })
      }
      response.end()
    } catch (error) {
      if (response.destroyed || request.aborted) return
      if (response.headersSent) return response.destroy()
      const status = timedOut ? 504 : (error.status ?? 502)
      const message = timedOut
        ? "模型接口响应超时，请稍后重试或更换快速模型"
        : error.status
          ? error.message
          : "无法连接模型接口，请检查地址、网络和接口服务状态"
      sendJson(response, status, { error: { message, code: timedOut ? "upstream_timeout" : (error.code ?? "upstream_unavailable") } })
    } finally {
      clearTimeout(timer)
      request.off("aborted", cancel)
      response.off("close", onClose)
      if (reader) {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      // Drain rejected bodies without retaining them so an error response can reach the caller.
      if (!request.complete && !request.destroyed) request.resume()
    }
  }
}

function validateLocalRequest(request) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) {
    throw requestError(403, "此代理仅允许本机访问", "loopback_only")
  }
  const host = request.headers.host
  const match = typeof host === "string" && /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host)
  const protocol = request.socket.encrypted ? "https:" : "http:"
  const port = match && Number(match[2] ?? (protocol === "https:" ? 443 : 80))
  if (!match || port !== request.socket.localPort) {
    throw requestError(403, "代理仅接受当前本机端口的 Host", "invalid_host")
  }
  const origin = request.headers.origin
  if (origin !== undefined && origin !== new URL(`${protocol}//${host}`).origin) {
    throw requestError(403, "代理不接受跨站请求，请从本机应用页面访问", "invalid_origin")
  }
}

function validatePayload(payload, origins) {
  if (!isRecord(payload) || typeof payload.url !== "string" || !isRecord(payload.body) || (payload.headers !== undefined && !isRecord(payload.headers))) {
    throw requestError(400, "请求格式无效，需要 url、body 对象和可选 headers 对象", "invalid_payload")
  }
  let target
  try {
    target = new URL(payload.url)
  } catch {
    throw requestError(400, "模型接口地址无效", "invalid_url")
  }
  if (target.username || target.password || target.search || target.hash || !["https:", "http:"].includes(target.protocol)) {
    throw requestError(400, "模型接口地址不能包含账号、密码、查询参数或片段", "invalid_url")
  }
  if (!origins.has(target.origin)) {
    throw requestError(403, "此模型接口来源未获允许，请在 SPACESHIP_ALLOWED_ORIGINS 中添加它的来源地址", "origin_not_allowed")
  }
  const isChat = /^(?:\/[A-Za-z0-9._~-]+)*\/chat\/completions$/.test(target.pathname)
  const isDecisions = target.origin === "https://generativelanguage.googleapis.com" && target.pathname === "/v1beta/decisions"
  if (!isChat && !isDecisions) {
    throw requestError(400, "代理仅允许 chat/completions 或 Gemini Decisions 接口", "path_not_allowed")
  }
  const headers = { "content-type": "application/json" }
  const seen = new Set()
  for (const [name, value] of Object.entries(payload.headers ?? {})) {
    const lower = name.toLowerCase()
    if (!FORWARDED_HEADERS.has(lower)) continue
    if (typeof value !== "string" || /[\r\n]/.test(value) || seen.has(lower)) {
      throw requestError(400, "模型请求头格式无效", "invalid_headers")
    }
    seen.add(lower)
    if (lower === "content-type") {
      if (value.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw requestError(400, "模型接口仅支持 JSON 请求", "invalid_headers")
      }
    } else {
      headers[lower] = value
    }
  }
  return { url: target, headers, body: payload.body }
}

function readPayload(request, signal, maxBodyBytes) {
  if (Number(request.headers["content-length"] ?? 0) > maxBodyBytes) {
    return Promise.reject(requestError(413, "请求内容过大，请缩短故事上下文", "payload_too_large"))
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    const cleanup = () => {
      request.off("data", onData)
      request.off("end", onEnd)
      request.off("error", onError)
      signal.removeEventListener("abort", onAbort)
    }
    const fail = (error) => {
      cleanup()
      request.resume()
      reject(error)
    }
    const onData = (chunk) => {
      bytes += chunk.length
      if (bytes > maxBodyBytes) return fail(requestError(413, "请求内容过大，请缩短故事上下文", "payload_too_large"))
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(requestError(400, "请求内容不是有效的 JSON", "invalid_json"))
      }
    }
    const onError = (error) => fail(error)
    const onAbort = () => fail(signal.reason)
    request.on("data", onData)
    request.once("end", onEnd)
    request.once("error", onError)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function normalizeOrigin(value) {
  let parsed
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error("SPACESHIP_ALLOWED_ORIGINS 含有无效来源地址")
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal))
  ) {
    throw new Error("额外来源必须是 HTTPS 来源，或本机 HTTP 来源；不能含路径、账号、查询参数或片段")
  }
  return parsed.origin
}

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.setHeader("x-content-type-options", "nosniff")
  response.end(JSON.stringify(body))
}

function requestError(status, message, code) {
  return Object.assign(new Error(message), { status, code })
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
