import { getProvider, PROVIDERS, type ProviderId } from "./providers.ts"

export type ModelRole = "generation" | "analysis"
export type ModelProfile = {
  provider: ProviderId
  baseUrl: string
  model: string
  apiKey: string
  fastMode: boolean
  jsonMode: boolean
}
export type AppSettings = {
  generation: ModelProfile
  analysis: ModelProfile
  analysisUsesGeneration: boolean
  decisionBackend: "compatible" | "gemini"
  geminiApiKey: string
  rememberKeys: boolean
  transport: "proxy" | "direct"
}

const SETTINGS_KEY = "spaceship-settings-v1"
const SECRETS_KEY = "spaceship-secrets-v1"
const LEGACY_CEREBRAS_KEY = "cerebras-api-key"
const LEGACY_GEMINI_KEY = "gemini-api-key"

export function getSettings(): AppSettings {
  const saved = readJSON(storage("localStorage"), SETTINGS_KEY)
  const settings: AppSettings = {
    generation: profileOf(saved.generation),
    analysis: profileOf(saved.analysis),
    analysisUsesGeneration: saved.analysisUsesGeneration !== false,
    decisionBackend: saved.decisionBackend === "gemini" ? "gemini" : "compatible",
    geminiApiKey: "",
    rememberKeys: saved.rememberKeys === true,
    transport: saved.transport === "direct" ? "direct" : "proxy",
  }
  const secrets = readJSON(storage(settings.rememberKeys ? "localStorage" : "sessionStorage"), SECRETS_KEY)
  settings.generation.apiKey = profileSecret(secrets.generation, settings.generation)
  settings.analysis.apiKey = profileSecret(secrets.analysis, settings.analysis)
  settings.geminiApiKey = stringOf(secrets.gemini)

  if (!Object.keys(saved).length) {
    const legacyCerebras = read(storage("localStorage"), LEGACY_CEREBRAS_KEY)?.trim()
    const legacyGemini = read(storage("localStorage"), LEGACY_GEMINI_KEY)?.trim()
    if (legacyCerebras || legacyGemini) {
      if (legacyCerebras) settings.generation = { ...profileOf({ provider: "cerebras" }), apiKey: legacyCerebras }
      if (legacyGemini) {
        settings.geminiApiKey = legacyGemini
        settings.decisionBackend = "gemini"
      }
      saveSettings(settings)
    }
  }
  return settings
}

export function saveSettings(settings: AppSettings): void {
  const normalized: AppSettings = {
    ...settings,
    generation: cleanProfile(settings.generation),
    analysis: cleanProfile(settings.analysis),
    geminiApiKey: settings.geminiApiKey.trim(),
  }
  const config = {
    ...normalized,
    generation: { ...normalized.generation, apiKey: "" },
    analysis: { ...normalized.analysis, apiKey: "" },
    geminiApiKey: "",
  }
  const secrets = JSON.stringify({
    generation: boundSecret(normalized.generation),
    analysis: boundSecret(normalized.analysis),
    gemini: normalized.geminiApiKey,
  })
  const local = storage("localStorage")
  const session = storage("sessionStorage")
  const secretStorage = settings.rememberKeys ? local : session
  const otherStorage = settings.rememberKeys ? session : local
  if (!local || !secretStorage) throw new Error("浏览器存储不可用，请允许此页面使用本地及会话存储。")
  secretStorage.setItem(SECRETS_KEY, secrets)
  otherStorage?.removeItem(SECRETS_KEY)
  local.setItem(SETTINGS_KEY, JSON.stringify(config))
  local.removeItem(LEGACY_CEREBRAS_KEY)
  local.removeItem(LEGACY_GEMINI_KEY)
}

export function clearStoredKeys(): void {
  for (const store of [storage("localStorage"), storage("sessionStorage")]) {
    store?.removeItem(SECRETS_KEY)
    store?.removeItem(LEGACY_CEREBRAS_KEY)
    store?.removeItem(LEGACY_GEMINI_KEY)
  }
}

export function getModelProfile(role: ModelRole): ModelProfile {
  const settings = getSettings()
  return role === "generation" || settings.analysisUsesGeneration ? settings.generation : settings.analysis
}

export function validateSettings(settings: AppSettings, role: ModelRole | "all" = "all"): string[] {
  const errors: string[] = []
  if (role !== "analysis") errors.push(...validateProfile(settings.generation, "生成模型"))
  if (role !== "generation") {
    const profile = settings.analysisUsesGeneration ? settings.generation : settings.analysis
    errors.push(...validateProfile(profile, "分析模型"))
    if (settings.decisionBackend === "gemini" && !settings.geminiApiKey.trim()) errors.push("请填写 Gemini API Key。")
  }
  return [...new Set(errors)]
}

export function validateProfile(profile: ModelProfile, label = "模型"): string[] {
  const errors: string[] = []
  if (!profile.model.trim()) errors.push(`请填写${label}的模型名称。`)
  if (profile.provider !== "custom" && !profile.apiKey.trim()) errors.push(`请填写${label}的 API Key。`)
  try {
    const url = new URL(profile.baseUrl.trim())
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error()
    if (url.username || url.password || url.search || url.hash) throw new Error()
    if (/\/(responses|messages)\/?$/.test(url.pathname)) errors.push(`${label}需要 Chat Completions 兼容地址。`)
  } catch {
    errors.push(`请填写${label}有效的 HTTPS 接口地址（本机地址可用 HTTP），不要在地址中填写密钥。`)
  }
  return errors
}

function profileOf(value: unknown): ModelProfile {
  const data = isRecord(value) ? value : {}
  const provider = getProvider(typeof data.provider === "string" && PROVIDERS.some(({ id }) => id === data.provider) ? data.provider : "deepseek")
  return {
    provider: provider.id,
    baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : provider.baseUrl,
    model: typeof data.model === "string" ? data.model : provider.model,
    apiKey: "",
    fastMode: typeof data.fastMode === "boolean" ? data.fastMode : provider.defaultFastMode,
    jsonMode: data.jsonMode !== false,
  }
}

function boundSecret(profile: ModelProfile) {
  return { provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey }
}

function profileSecret(value: unknown, profile: ModelProfile): string {
  // Other tabs share configuration, but their session keys belong to different endpoints.
  if (!isRecord(value) || value.provider !== profile.provider || value.baseUrl !== profile.baseUrl.trim().replace(/\/+$/, "")) return ""
  return stringOf(value.apiKey)
}

function cleanProfile(profile: ModelProfile): ModelProfile {
  return { ...profile, baseUrl: profile.baseUrl.trim().replace(/\/+$/, ""), model: profile.model.trim(), apiKey: profile.apiKey.trim() }
}

function storage(name: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return globalThis[name]
  } catch {
    return undefined
  }
}

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function readJSON(store: Storage | undefined, key: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(read(store, key) ?? "{}")
    return isRecord(result) ? result : {}
  } catch {
    return {}
  }
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
