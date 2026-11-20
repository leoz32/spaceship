import { bindModelSettings } from "./model-settings.ts"

/** Switching modes reloads the app; settings can also be edited while a mode is active. */
export function bindModeToggle(toggle: HTMLButtonElement, settingsButton: HTMLButtonElement, dialog: HTMLDialogElement, isLive: boolean) {
  const settings = bindModelSettings(dialog, isLive, reloadAs)
  toggle.setAttribute("aria-pressed", `${isLive}`)
  toggle.querySelector("b")!.textContent = isLive ? "实时" : "模拟"

  toggle.addEventListener("click", () => {
    if (isLive) return reloadAs(false)
    settings.open()
  })
  settingsButton.addEventListener("click", settings.open)
  return settings
}

function reloadAs(isLive: boolean) {
  const url = new URL(location.href)
  if (isLive) url.searchParams.set("live", "true")
  else url.searchParams.delete("live")
  location.assign(url)
}
