import assert from "node:assert/strict"
import { createServer, request as httpRequest } from "node:http"
import { once } from "node:events"
import { test } from "node:test"
import { createLlmProxy } from "../server/llm-proxy.mjs"
import { getProvider } from "../src/llm/providers.ts"
import { completionBody, completionUrl } from "../src/llm/cerebras.ts"

async function listen(t, handler) {
  const server = createServer(handler)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

async function fixture(t, upstreamHandler, options = {}) {
  const upstream = await listen(t, upstreamHandler)
  const middleware = createLlmProxy({ allowedOrigins: [upstream.origin], ...options })
  const proxy = await listen(t, (req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404
      res.end("not found")
    })
  })
  const payload = (overrides = {}) => ({
    url: `${upstream.origin}/v1/chat/completions`,
    headers: { Authorization: "Bearer test-only-secret" },
    body: { model: "mock-model", messages: [{ role: "user", content: "测试" }], stream: true },
    ...overrides,
  })
  const post = (body = payload(), init = {}) =>
    fetch(`${proxy.origin}/api/llm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init })
  return { upstream, proxy, payload, post }
}

async function rejection(response, status, code) {
  assert.equal(response.status, status)
  assert.equal((await response.json()).error.code, code)
  assert.equal(response.headers.get("access-control-allow-origin"), null)
}

function rawRequest(origin, { path = "/api/llm", method = "POST", headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}${path}`, { method, headers }, (res) => {
      const data = []
      res.on("data", (chunk) => data.push(chunk))
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data).toString("utf8") }))
    })
    req.on("error", reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
}

test("health succeeds only at the local host and leaves unrelated paths alone", async (t) => {
  const { proxy } = await fixture(t, (_req, res) => res.end())
  const health = await fetch(`${proxy.origin}/api/health`)
  assert.deepEqual(await health.json(), { proxy: true })
  assert.equal(health.headers.get("cache-control"), "no-store")
  assert.equal((await fetch(`${proxy.origin}/elsewhere`)).status, 404)
  await rejection(await fetch(`${proxy.origin}/api/health`, { method: "POST" }), 405, "method_not_allowed")
})

test("SSE reaches the client incrementally, preserving Unicode and upstream headers", { timeout: 5000 }, async (t) => {
  let finish
  const readyToFinish = new Promise((resolve) => (finish = resolve))
  t.after(() => finish())
  let received
  const { post } = await fixture(t, async (req, res) => {
    const data = []
    for await (const chunk of req) data.push(chunk)
    received = { headers: req.headers, body: JSON.parse(Buffer.concat(data)) }
    res.setHeader("content-type", "text/event-stream; charset=utf-8")
    res.write('data: {"choices":[{"delta":{"content":"中文第一段"}}]}\n\n')
    await readyToFinish
    res.end('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n\n')
  })
  const response = await post()
  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type"), /text\/event-stream/)
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.equal(first.done, false)
  assert.match(new TextDecoder().decode(first.value), /中文第一段/)
  assert.doesNotMatch(new TextDecoder().decode(first.value), /第二段/)
  assert.equal(received.body.model, "mock-model")
  assert.equal(received.headers.authorization, "Bearer test-only-secret")
  finish()
  let tail = ""
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    tail += new TextDecoder().decode(chunk.value)
  }
  assert.match(tail, /第二段/)
  assert.match(tail, /\[DONE\]/)
})

test("cancelling the client stream closes the upstream connection", { timeout: 5000 }, async (t) => {
  let closed
  const upstreamClosed = new Promise((resolve) => (closed = resolve))
  const { post } = await fixture(t, (_req, res) => {
    res.setHeader("content-type", "text/event-stream")
    res.once("close", closed)
    res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n')
  })
  const response = await post()
  const reader = response.body.getReader()
  await reader.read()
  await reader.cancel()
  await upstreamClosed
})

test("cross-origin browser requests and the null origin are rejected before contacting a model", async (t) => {
  let calls = 0
  const { post, payload, proxy } = await fixture(t, (_req, res) => {
    calls++
    res.end("{}")
  })
  for (const origin of ["https://example.com", "null", `${proxy.origin}/`, "http://localhost:9"]) {
    await rejection(await post(payload(), { headers: { "content-type": "application/json", origin } }), 403, "invalid_origin")
  }
  assert.equal(calls, 0)
  const accepted = await post(payload(), { headers: { "content-type": "application/json", origin: proxy.origin } })
  assert.equal(accepted.status, 200)
  assert.equal(calls, 1)
})

test("Host must identify the exact loopback listener port", async (t) => {
  const { proxy, payload } = await fixture(t, (_req, res) => res.end("{}"))
  for (const host of ["example.com", "127.0.0.1:9", "localhost.evil.example:1234", "user@localhost", "localhost:65536"]) {
    const response = await rawRequest(proxy.origin, { headers: { host, "content-type": "application/json" }, chunks: [JSON.stringify(payload())] })
    assert.equal(response.status, 403)
    assert.equal(JSON.parse(response.body).error.code, "invalid_host")
  }
})

test("non-loopback clients cannot use the middleware", async () => {
  const middleware = createLlmProxy()
  const request = {
    url: "/api/health",
    method: "GET",
    socket: { remoteAddress: "192.168.1.2", localPort: 5173 },
    headers: { host: "localhost:5173" },
    complete: true,
    once() {},
    off() {},
  }
  let result
  const response = {
    once() {},
    off() {},
    setHeader() {},
    end(value) {
      result = JSON.parse(value)
    },
  }
  await middleware(request, response, () => assert.fail("Unexpected next()"))
  assert.equal(response.statusCode, 403)
  assert.equal(result.error.code, "loopback_only")
})

test("only JSON POST bodies are accepted; preflight never enables CORS", async (t) => {
  const { proxy, post } = await fixture(t, (_req, res) => res.end("{}"))
  await rejection(await fetch(`${proxy.origin}/api/llm`, { method: "OPTIONS" }), 405, "method_not_allowed")
  await rejection(await post({}, { headers: { "content-type": "text/plain" } }), 415, "unsupported_content_type")
  await rejection(await post({}, { body: "{broken" }), 400, "invalid_json")
  await rejection(await post([]), 400, "invalid_payload")
})

test("destinations require an allowlisted origin and a permitted endpoint", async (t) => {
  let calls = 0
  const { post, payload, upstream } = await fixture(t, (_req, res) => {
    calls++
    res.end("{}")
  })
  await rejection(await post(payload({ url: "http://127.0.0.1:9/v1/chat/completions" })), 403, "origin_not_allowed")
  for (const url of [
    `${upstream.origin}/admin`,
    `${upstream.origin}/v1beta/decisions`,
    `${upstream.origin}/v1/chat/completions/`,
    `${upstream.origin}/v1/%63hat/completions`,
  ]) {
    await rejection(await post(payload({ url })), 400, "path_not_allowed")
  }
  for (const url of [
    `${upstream.origin}/v1/chat/completions?key=secret`,
    `${upstream.origin}/v1/chat/completions#fragment`,
    upstream.origin.replace("http://", "http://user:password@") + "/v1/chat/completions",
  ]) {
    await rejection(await post(payload({ url })), 400, "invalid_url")
  }
  assert.equal(calls, 0)
})

test("only model authentication headers are forwarded", async (t) => {
  let headers
  const { post, payload } = await fixture(t, (req, res) => {
    headers = req.headers
    res.end("{}")
  })
  const response = await post(
    payload({
      headers: {
        Authorization: "Bearer test",
        "x-goog-api-key": "test-google",
        "Content-Type": "application/json",
        cookie: "private=test",
        "X-Forwarded-For": "1.2.3.4",
        host: "evil.example",
        "x-untrusted": "ignore",
      },
    }),
  )
  assert.equal(response.status, 200)
  assert.equal(headers.authorization, "Bearer test")
  assert.equal(headers["x-goog-api-key"], "test-google")
  assert.equal(headers.cookie, undefined)
  assert.equal(headers["x-forwarded-for"], undefined)
  assert.equal(headers["x-untrusted"], undefined)
  assert.notEqual(headers.host, "evil.example")
  await rejection(await post(payload({ headers: { Authorization: "Bearer bad\r\nHeader: x" } })), 400, "invalid_headers")
  await rejection(await post(payload({ headers: { Authorization: "a", authorization: "b" } })), 400, "invalid_headers")
})

test("upstream redirects are not followed", async (t) => {
  let redirected = false
  const { post, upstream } = await fixture(t, (req, res) => {
    if (req.url === "/target") redirected = true
    res.statusCode = 307
    res.setHeader("location", `${upstream.origin}/target`)
    res.end()
  })
  await rejection(await post(), 502, "redirect_blocked")
  assert.equal(redirected, false)
})

test("oversized bodies are rejected with and without Content-Length", async (t) => {
  const { post, proxy } = await fixture(t, (_req, res) => res.end("{}"), { maxBodyBytes: 128 })
  await rejection(await post({ padding: "x".repeat(256) }), 413, "payload_too_large")
  const chunked = await rawRequest(proxy.origin, {
    headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
    chunks: ["x".repeat(80), "y".repeat(80)],
  })
  assert.equal(chunked.status, 413)
  assert.equal(JSON.parse(chunked.body).error.code, "payload_too_large")
})

test("a stalled model request has a finite deadline and is aborted", { timeout: 5000 }, async (t) => {
  let closed
  const upstreamClosed = new Promise((resolve) => (closed = resolve))
  const { post } = await fixture(
    t,
    (_req, res) => {
      res.once("close", closed)
    },
    { timeoutMs: 100 },
  )
  await rejection(await post(), 504, "upstream_timeout")
  await upstreamClosed
})

test("upstream rate limits preserve their status and Retry-After", async (t) => {
  const { post } = await fixture(t, (_req, res) => {
    res.statusCode = 429
    res.setHeader("content-type", "application/json")
    res.setHeader("retry-after", "30")
    res.end(JSON.stringify({ error: { message: "test rate limit" } }))
  })
  const response = await post()
  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), "30")
  assert.equal((await response.json()).error.message, "test rate limit")
})

test("custom origin settings cannot smuggle credentials or endpoint paths", () => {
  for (const origin of ["http://example.com", "https://user:pass@example.com", "https://example.com/v1", "https://example.com?key=test", "not-a-url"]) {
    assert.throws(() => createLlmProxy({ allowedOrigins: [origin] }))
  }
  assert.doesNotThrow(() => createLlmProxy({ allowedOrigins: ["http://127.0.0.1:11434", "http://localhost:1234", "http://[::1]:8080", "https://example.com"] }))
})

test("Command Code preset routes through the default proxy allowlist without vendor-specific parameters", async (t) => {
  const provider = getProvider("commandcode")
  assert.equal(provider.id, "commandcode")
  assert.equal(provider.defaultFastMode, false)
  const profile = {
    provider: provider.id,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: "mock-commandcode-key",
    fastMode: provider.defaultFastMode,
    jsonMode: true,
  }
  const request = { system: "测试", user: "你好", temperature: 0.3, maxCompletionTokens: 64, signal: new AbortController().signal }
  const body = completionBody(profile, request, true)
  assert.equal(body.model, "deepseek/deepseek-v4-flash")
  assert.equal(body.stream, true)
  assert.equal(body.max_tokens, 64)
  for (const parameter of ["thinking", "enable_thinking", "reasoning_effort"]) assert.ok(!(parameter in body))

  const middleware = createLlmProxy({ allowedOrigins: [] })
  const proxy = await listen(
    t,
    (req, res) =>
      void middleware(req, res, () => {
        res.statusCode = 404
        res.end()
      }),
  )
  const nativeFetch = globalThis.fetch
  let upstreamCalls = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    if (url.origin === proxy.origin) return nativeFetch(input, init)
    assert.equal(url.href, "https://api.commandcode.ai/provider/v1/chat/completions")
    assert.equal(init.headers.authorization, "Bearer mock-commandcode-key")
    assert.equal(init.redirect, "manual")
    assert.deepEqual(JSON.parse(init.body), body)
    upstreamCalls++
    return new Response('data: {"choices":[{"delta":{"content":"中文连接成功"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":12}}\n\ndata: [DONE]\n\n', {
      headers: { "content-type": "text/event-stream" },
    })
  }
  t.after(() => {
    globalThis.fetch = nativeFetch
  })
  const envelope = { url: completionUrl(profile.baseUrl), headers: { Authorization: `Bearer ${profile.apiKey}` }, body }
  const post = (payload) =>
    nativeFetch(`${proxy.origin}/api/llm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
  const response = await post(envelope)
  assert.equal(response.status, 200)
  const streamed = await response.text()
  assert.match(streamed, /中文连接成功/)
  assert.match(streamed, /\[DONE\]/)
  for (const endpoint of ["messages", "responses", "systemone"]) {
    await rejection(await post({ ...envelope, url: `${provider.baseUrl}/${endpoint}` }), 400, "path_not_allowed")
  }
  assert.equal(upstreamCalls, 1, "Only the mocked Chat Completions request may be forwarded")
})
