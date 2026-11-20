type ModelFailure = { message: string; source: "generation" | "analysis" }

export function reportModelError(error: unknown, source: ModelFailure["source"] = "analysis") {
  if (error instanceof Error && error.name === "AbortError") return
  const message = error instanceof Error ? error.message : "模型请求失败，请检查设置。"
  window.dispatchEvent(new CustomEvent<ModelFailure>("spaceship:model-error", { detail: { message, source } }))
}

export function bindModelNotice(element: HTMLElement, onGenerationFailure: () => void, retry: () => void, openSettings: () => void) {
  const output = element.querySelector<HTMLOutputElement>("output")!
  let lastMessage = ""
  window.addEventListener("spaceship:model-error", (event) => {
    const { message, source } = (event as CustomEvent<ModelFailure>).detail
    if (source === "generation") onGenerationFailure()
    const text = `${source === "generation" ? "续写已暂停" : "分析暂不可用"}：${message}`
    if (lastMessage !== text) output.textContent = text
    lastMessage = text
    element.hidden = false
  })
  element.querySelector<HTMLButtonElement>("[data-retry]")!.addEventListener("click", () => {
    element.hidden = true
    lastMessage = ""
    retry()
  })
  element.querySelector<HTMLButtonElement>("[data-settings]")!.addEventListener("click", openSettings)
  element.querySelector<HTMLButtonElement>("[data-dismiss]")!.addEventListener("click", () => {
    element.hidden = true
  })
}
