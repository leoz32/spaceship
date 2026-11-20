import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright-core"
import { createServer as createViteServer } from "vite"

const root = resolve(import.meta.dirname, "..")
const originalFetch = globalThis.fetch
const originalOrigins = process.env.SPACESHIP_ALLOWED_ORIGINS
const modelRequests = []
const externalRequests = []
const pageErrors = []
const passed = []
const allowedOrigins = new Set()
let vite
let browser
let page

// Keep the test hermetic even if a regression accidentally selects a real provider.
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
  if (!allowedOrigins.has(url.origin)) {
    externalRequests.push(url.origin)
    return Promise.reject(new Error("UI 测试禁止访问外部服务"))
  }
  return originalFetch(input, init)
}

const mock = createServer((request, response) => void respondToModel(request, response))

try {
  mock.listen(0, "127.0.0.1")
  await once(mock, "listening")
  const mockOrigin = `http://127.0.0.1:${mock.address().port}`
  allowedOrigins.add(mockOrigin)
  process.env.SPACESHIP_ALLOWED_ORIGINS = mockOrigin
  vite = await createViteServer({ root, configFile: resolve(root, "vite.config.ts"), server: { host: "127.0.0.1", port: 0 } })
  await vite.listen()
  const appOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`
  allowedOrigins.add(appOrigin)
  const appUrl = `${appOrigin}${vite.config.base}`

  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.origin === appOrigin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
    externalRequests.push(url.origin)
    return route.abort("blockedbyclient")
  })
  page = await context.newPage()
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.setDefaultTimeout(8000)
  await page.goto(appUrl)
  await page.waitForFunction(() => document.querySelector('#status [data-field="words"] small')?.textContent?.match(/\+[1-9]/))
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN")
  assert.match(await page.title(), /中文版/)
  assert.equal(await page.locator("#mode-toggle b").innerText(), "模拟")
  await dragReader(page, 5)
  await page.waitForFunction(() => /[\u4e00-\u9fff]/.test(document.querySelector("#text")?.textContent ?? ""))
  assert.equal(modelRequests.length, 0, "模拟模式不应请求模型")
  mark("模拟模式显示中文，且没有调用模型或外部服务")

  await page.locator("#settings-toggle").click()
  await page.locator("#live-keys").waitFor({ state: "visible" })
  await page.locator('[name="generation-provider"]').selectOption("qwen")
  assert.equal(await page.locator('[name="generation-base-url"]').inputValue(), "https://dashscope.aliyuncs.com/compatible-mode/v1")
  assert.ok((await page.locator('[name="generation-model"]').inputValue()).startsWith("qwen"))
  await page.locator('[name="generation-key"]').fill("ui-fixture-not-a-real-key")
  await page.locator('[name="generation-provider"]').selectOption("zhipu")
  assert.equal(await page.locator('[name="generation-key"]').inputValue(), "")
  assert.equal(await page.locator('[name="generation-base-url"]').inputValue(), "https://open.bigmodel.cn/api/paas/v4")
  mark("厂商选择自动填入地址和模型；切换厂商清空旧密钥")

  await fillProfile(page, "generation", mockOrigin, "fixture")
  assert.equal(await page.locator('[name="analysis-shared"]').isChecked(), true)
  assert.equal(await page.locator("#analysis-profile").isVisible(), false)
  await page.locator('[data-test="generation"]').click()
  await page.waitForFunction(() => document.querySelector("#settings-result")?.textContent?.includes("生成模型已连接"))
  assert.ok(modelRequests.some((request) => request.kind === "probe" && request.body.stream === true && request.body.model === "fixture"))
  mark("通过设置界面完成本机代理流式连接测试")

  await page.locator('[name="generation-model"]').fill("fixture-slow")
  await page.locator('[data-test="generation"]').click()
  await eventually(() => modelRequests.some((request) => request.body.model === "fixture-slow"), "慢速连接测试应到达本机模型")
  await page.locator('[name="generation-model"]').fill("fixture")
  await eventually(() => modelRequests.some((request) => request.body.model === "fixture-slow" && request.cancelled), "编辑配置应取消上游连接")
  assert.equal(await page.locator('[data-test="generation"]').isEnabled(), true)
  mark("编辑配置会取消正在运行的连接测试及其上游请求")

  await page.locator('[name="analysis-shared"]').uncheck()
  assert.equal(await page.locator("#analysis-profile").isVisible(), true)
  await fillProfile(page, "analysis", mockOrigin, "fixture-analysis")
  await page.locator('[data-test="analysis"]').click()
  await page.waitForFunction(() => document.querySelector("#settings-result")?.textContent?.includes("分析模型已连接"))
  assert.ok(modelRequests.some((request) => request.kind === "probe" && request.body.model === "fixture-analysis"))
  await page.locator('[name="analysis-shared"]').check()
  assert.equal(await page.locator("#analysis-profile").isVisible(), false)
  await page.screenshot({ path: "/tmp/spaceship-ui-settings.png" })
  mark("分析模型可单独设置和测试，也可切回复用生成模型")

  await Promise.all([page.waitForEvent("load"), page.locator('button[value="live"]').click()])
  await page.waitForFunction(() => document.querySelector("#mode-toggle b")?.textContent === "实时")
  await eventually(() => modelRequests.some((request) => request.kind === "generation" && request.body.model === "fixture"), "实时模式应开始中文续写")
  await page.waitForFunction(() => !document.querySelector("#pointer")?.hasAttribute("data-generating"))
  await dragReader(page, 6)
  await page.waitForFunction(() => (document.querySelector("#text")?.textContent?.length ?? 0) > 100)
  await eventually(() => modelRequests.some((request) => request.kind === "attention"), "阅读后应预取重点分析")
  await page.locator("#pointer").dblclick()
  await page.waitForFunction(() => Number(document.querySelector('#status [data-field="boxes"] b')?.textContent) > 0)
  await eventually(() => modelRequests.some((request) => request.kind === "decision"), "重点与句子应触发兼容 JSON 评分")
  assert.ok(
    modelRequests
      .filter((request) => ["generation", "attention", "dimension", "decision"].includes(request.kind))
      .every((request) => request.body.model === "fixture"),
  )
  assert.ok(modelRequests.filter((request) => request.kind === "decision").every((request) => request.body.response_format?.type === "json_object"))
  assert.ok(!modelRequests.some((request) => request.path.includes("decisions")))
  assert.equal(await page.locator("#model-message").isVisible(), false, "有效的模拟模型不应产生界面错误")
  await page.mouse.move(1100, 150)
  await page.screenshot({ path: "/tmp/spaceship-ui-main.png" })
  mark("保存进入实时模式；拖动阅读中文、重点高亮和 JSON 评分均完成，未依赖 Gemini")

  await page.locator("#settings-toggle").click()
  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 844 })
    const bounds = await page.locator("#live-keys").boundingBox()
    assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${width}px 下设置弹窗不应横向溢出`)
    const overflow = await page.locator("#live-keys").evaluate((element) => element.scrollWidth - element.clientWidth)
    assert.ok(overflow <= 1, `${width}px 下设置弹窗内容不应横向溢出`)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator("[data-cancel]").click()
  mark("390px 与 640px 设置弹窗和内容均无横向溢出")

  for (const status of [401, 429]) {
    await page.locator("#settings-toggle").click()
    await page.locator('[name="generation-model"]').fill(`fixture-error-${status}`)
    await Promise.all([page.waitForEvent("load"), page.locator('button[value="live"]').click()])
    await page.locator("#model-message").waitFor({ state: "visible" })
    assert.match(await page.locator("#model-message output").innerText(), new RegExp(`HTTP ${status}`))
    const requestsAfterError = modelRequests.filter((request) => request.body.model === `fixture-error-${status}` && request.kind === "generation").length
    assert.equal(requestsAfterError, 1)
    await delay(1400)
    assert.equal(
      modelRequests.filter((request) => request.body.model === `fixture-error-${status}` && request.kind === "generation").length,
      requestsAfterError,
      "错误后不应自动重复续写请求",
    )
    mark(`HTTP ${status} 在界面显示错误并暂停续写，没有自动重复请求`)
  }

  assert.deepEqual(externalRequests, [], "测试期间不得访问外部服务")
  assert.deepEqual(pageErrors, [], "页面不得产生未捕获异常")
  console.log(
    JSON.stringify(
      {
        result: "passed",
        checks: passed.length,
        modelRequests: modelRequests.length,
        externalRequests: 0,
        pageErrors: 0,
        screenshots: ["/tmp/spaceship-ui-main.png", "/tmp/spaceship-ui-settings.png"],
      },
      null,
      2,
    ),
  )
} catch (error) {
  if (page) await page.screenshot({ path: "/tmp/spaceship-ui-failure.png" }).catch(() => {})
  console.error(error)
  console.error(
    JSON.stringify(
      {
        result: "failed",
        passed,
        pageErrors,
        externalRequests,
        requests: modelRequests.map(({ kind, body, cancelled }) => ({ kind, model: body.model, cancelled })),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
} finally {
  await browser?.close()
  await vite?.close()
  mock.closeAllConnections()
  if (mock.listening) await new Promise((resolve) => mock.close(resolve))
  globalThis.fetch = originalFetch
  if (originalOrigins === undefined) delete process.env.SPACESHIP_ALLOWED_ORIGINS
  else process.env.SPACESHIP_ALLOWED_ORIGINS = originalOrigins
}

async function fillProfile(target, role, origin, model) {
  await target.locator(`[name="${role}-provider"]`).selectOption("custom")
  await target.locator(`[name="${role}-base-url"]`).fill(`${origin}/v1`)
  await target.locator(`[name="${role}-model"]`).fill(model)
  await target.locator(`[name="${role}-key"]`).fill("ui-fixture-not-a-real-key")
}

async function dragReader(target, lines) {
  const knob = await target.locator("#pointer").boundingBox()
  const text = await target.locator("#text").boundingBox()
  assert.ok(knob && text)
  await target.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
  await target.mouse.down()
  await target.mouse.move(text.x + text.width * 0.8, text.y + 32 + lines * 22, { steps: 16 })
  await target.mouse.up()
}

async function eventually(predicate, message, timeout = 8000) {
  const deadline = performance.now() + timeout
  while (!predicate()) {
    if (performance.now() > deadline) assert.fail(message)
    await delay(20)
  }
}

function mark(message) {
  passed.push(message)
  console.log(`PASS ${message}`)
}

async function respondToModel(request, response) {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    const system = body.messages?.[0]?.content ?? ""
    const user = body.messages?.[1]?.content ?? ""
    const kind = system.includes("接口连接测试")
      ? "probe"
      : system.includes("语义分析器")
        ? "decision"
        : system.includes("可供选择的方向")
          ? "dimension"
          : system.includes("关键短语")
            ? "attention"
            : "generation"
    const entry = { kind, body, path: request.url, cancelled: false }
    modelRequests.push(entry)
    response.once("close", () => {
      entry.cancelled = !response.writableEnded
    })
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" })
      return response.end(JSON.stringify({ error: { message: "测试只允许本机 chat/completions" } }))
    }
    const errorStatus = /^fixture-error-(401|429)$/.exec(body.model)?.[1]
    if (errorStatus) {
      response.writeHead(Number(errorStatus), { "content-type": "application/json" })
      return response.end(JSON.stringify({ error: { message: "这是本机测试错误，不是真实服务返回" } }))
    }
    let content
    if (kind === "decision") {
      const { questions } = JSON.parse(user)
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [
          id,
          question.type === "score"
            ? { type: "score", score: (question.criteria.length - 1) * 0.7 }
            : question.type === "noul"
              ? { type: "noul", noul: 0.8 }
              : { type: "choice", choice: Object.keys(question.criteria)[0] },
        ]),
      )
      content = JSON.stringify({ answers })
    } else if (kind === "attention") {
      const plain = user.replace(/\s/g, "")
      const words = [...new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(plain)].filter(({ isWordLike }) => isWordLike)
      content = words
        .slice(0, 3)
        .map(
          ({ segment, index }) => `${plain.slice(Math.max(0, index - 3), index)}[${segment}]${plain.slice(index + segment.length, index + segment.length + 4)}`,
        )
        .join("\n")
    } else if (kind === "dimension") {
      content = "张力: 轻松 | 紧张\n节奏: 简洁推进 | 细致展开\n表达: 对话 | 动作 | 描写\n氛围: 诙谐 | 温柔 | 沉郁 | 奇妙\n距离: 外部观察 | 内心体验"
    } else if (kind === "probe") {
      content = "连接成功"
    } else {
      content =
        "艾拉沿着月光照亮的石阶走进古堡，手里的钥匙轻轻发热。门后的书桌上放着一封没有署名的信，她认出那是父亲留下的笔迹。窗外的风忽然停了，走廊尽头却响起脚步声。她没有后退，而是握紧钥匙，推开那扇刻着星星的木门。".repeat(
          5,
        )
    }
    if (!body.stream) {
      response.writeHead(200, { "content-type": "application/json" })
      return response.end(
        JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }),
      )
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" })
    if (body.model === "fixture-slow") {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "连接" } }] })}\n\n`)
      return
    }
    const characters = [...content]
    for (let index = 0; index < characters.length; index += 12) {
      if (response.destroyed) return
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: characters.slice(index, index + 12).join("") } }] })}\n\n`)
      await delay(kind === "probe" ? 25 : 3)
    }
    response.end('data: {"choices":[],"usage":{"total_tokens":20}}\n\ndata: [DONE]\n\n')
  } catch {
    if (!response.destroyed && !response.writableEnded) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: { message: "本机模型夹具无法处理请求" } }))
    }
  }
}
