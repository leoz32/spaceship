import { probeModel } from "../llm/chat.ts"
import { getProvider, PROVIDERS } from "../llm/providers.ts"
import { clearStoredKeys, getSettings, saveSettings, validateSettings, type AppSettings, type ModelProfile, type ModelRole } from "../llm/settings.ts"

export function bindModelSettings(dialog: HTMLDialogElement, isLive: boolean, apply: (isLive: boolean) => void) {
  const form = dialog.querySelector<HTMLFormElement>("form")!
  const output = form.querySelector<HTMLOutputElement>("#settings-result")!
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement
  let testController: AbortController | undefined
  let revision = 0

  for (const role of ["generation", "analysis"] as const) {
    const providerSelect = select(`${role}-provider`)
    providerSelect.replaceChildren(...PROVIDERS.map(({ id, name }) => new Option(name, id)))
    providerSelect.addEventListener("change", () => {
      const provider = getProvider(providerSelect.value)
      writeProfile(role, {
        provider: provider.id,
        baseUrl: provider.baseUrl,
        model: provider.model,
        apiKey: "",
        fastMode: provider.defaultFastMode,
        jsonMode: true,
      })
    })
    form.querySelector<HTMLButtonElement>(`[data-test="${role}"]`)!.addEventListener("click", () => void test(role))
  }

  form.addEventListener("input", changed)
  form.addEventListener("change", () => {
    changed()
    updateVisibility()
  })
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const action = (event.submitter as HTMLButtonElement | null)?.value ?? "save"
    const settings = readForm()
    const errors = validateSettings(settings)
    if (errors.length) return showResult(errors.join("\n"), true)
    try {
      saveSettings(settings)
      cancelTest()
      dialog.close()
      apply(action === "live" || isLive)
    } catch (error) {
      showResult(errorMessage(error), true)
    }
  })
  form.querySelector<HTMLButtonElement>("[data-cancel]")!.addEventListener("click", () => dialog.close())
  form.querySelector<HTMLButtonElement>("[data-clear-keys]")!.addEventListener("click", () => {
    cancelTest()
    try {
      clearStoredKeys()
      input("generation-key").value = ""
      input("analysis-key").value = ""
      input("gemini-key").value = ""
      input("remember-keys").checked = false
      showResult("已清除这个页面保存的密钥。正在发送的请求可能仍会完成。", false)
    } catch (error) {
      showResult(errorMessage(error), true)
    }
  })
  dialog.addEventListener("close", cancelTest)

  return {
    open() {
      const settings = getSettings()
      writeProfile("generation", settings.generation)
      writeProfile("analysis", settings.analysis)
      input("analysis-shared").checked = settings.analysisUsesGeneration
      input("remember-keys").checked = settings.rememberKeys
      input("gemini-key").value = settings.geminiApiKey
      select("decision-backend").value = settings.decisionBackend
      select("transport").value = settings.transport
      output.textContent = ""
      output.removeAttribute("data-error")
      updateVisibility()
      dialog.showModal()
    },
  }

  function writeProfile(role: ModelRole, profile: ModelProfile) {
    select(`${role}-provider`).value = profile.provider
    input(`${role}-base-url`).value = profile.baseUrl
    input(`${role}-model`).value = profile.model
    input(`${role}-key`).value = profile.apiKey
    input(`${role}-fast-mode`).checked = profile.fastMode
    input(`${role}-json-mode`).checked = profile.jsonMode
    const provider = getProvider(profile.provider)
    const note = form.querySelector<HTMLElement>(`[data-provider-note="${role}"]`)!
    note.textContent = provider.description
    const docs = form.querySelector<HTMLAnchorElement>(`[data-provider-docs="${role}"]`)!
    docs.hidden = !provider.docsUrl
    docs.href = provider.docsUrl || "#"
    input(`${role}-fast-mode`).disabled = ["custom", "commandcode"].includes(profile.provider)
    input(`${role}-fast-mode`).parentElement!.title = provider.fastModeHint
  }

  function readProfile(role: ModelRole): ModelProfile {
    return {
      provider: getProvider(select(`${role}-provider`).value).id,
      baseUrl: input(`${role}-base-url`).value.trim(),
      model: input(`${role}-model`).value.trim(),
      apiKey: input(`${role}-key`).value.trim(),
      fastMode: input(`${role}-fast-mode`).checked,
      jsonMode: input(`${role}-json-mode`).checked,
    }
  }

  function readForm(): AppSettings {
    return {
      generation: readProfile("generation"),
      analysis: readProfile("analysis"),
      analysisUsesGeneration: input("analysis-shared").checked,
      decisionBackend: select("decision-backend").value === "gemini" ? "gemini" : "compatible",
      geminiApiKey: input("gemini-key").value.trim(),
      rememberKeys: input("remember-keys").checked,
      transport: select("transport").value === "direct" ? "direct" : "proxy",
    }
  }

  function updateVisibility() {
    const shared = input("analysis-shared").checked
    const group = form.querySelector<HTMLFieldSetElement>("#analysis-profile")!
    group.hidden = shared
    group.disabled = shared
    form.querySelector<HTMLElement>("#gemini-config")!.hidden = select("decision-backend").value !== "gemini"
    form.querySelector<HTMLElement>("#transport-note")!.textContent =
      select("transport").value === "proxy"
        ? "本机运行推荐使用代理。自定义地址需在本机 .env 的 SPACESHIP_ALLOWED_ORIGINS 中加入对应来源，具体见使用说明。"
        : "直连适用于静态网页，但厂商必须允许跨域请求。密钥会直接发送到你填写的接口地址。"
  }

  function cancelTest() {
    revision++
    testController?.abort()
    testController = undefined
    for (const button of form.querySelectorAll<HTMLButtonElement>("[data-test]")) button.disabled = false
  }

  function changed() {
    cancelTest()
    output.textContent = ""
    output.removeAttribute("data-error")
  }

  async function test(role: ModelRole) {
    cancelTest()
    const version = revision
    const settings = readForm()
    const profile = role === "analysis" && settings.analysisUsesGeneration ? settings.generation : settings[role]
    // This probes the chat model only. A separately selected native Gemini backend has its own credentials.
    const errors = validateSettings({ ...settings, decisionBackend: "compatible" }, role)
    if (errors.length) return showResult(errors.join("\n"), true)
    const controller = (testController = new AbortController())
    const label = role === "generation" ? "生成" : "分析"
    for (const button of form.querySelectorAll<HTMLButtonElement>("[data-test]")) button.disabled = true
    showResult(`正在测试${label}模型的流式连接…`, false)
    try {
      const result = await probeModel(profile, settings.transport, controller.signal)
      if (version !== revision || controller.signal.aborted) return
      showResult(`${label}模型已连接。首段响应约 ${Math.round(result.firstChunkMs)} 毫秒；返回：${result.sample}`, false)
    } catch (error) {
      if (version === revision && !controller.signal.aborted) showResult(errorMessage(error), true)
    } finally {
      if (version === revision) cancelTest()
    }
  }

  function showResult(message: string, isError: boolean) {
    output.textContent = message
    output.toggleAttribute("data-error", isError)
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请检查模型设置。"
}
