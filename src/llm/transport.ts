import { getSettings } from "./settings.ts"

export const MODEL_TIMEOUT_MS = 60_000
export type ModelApiError = Error & { status: number; retryable: boolean }

export function isRetryableError(error: unknown): boolean {
  return error instanceof Error && "retryable" in error && error.retryable === true
}

export async function postModelRequest(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  transport = getSettings().transport,
): Promise<Response> {
  signal.throwIfAborted()
  const target = transport === "proxy" ? new URL("api/llm", globalThis.location.origin).href : url
  const response = await fetch(target, {
    method: "POST",
    redirect: "error",
    signal,
    headers: transport === "proxy" ? { "Content-Type": "application/json" } : { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(transport === "proxy" ? { url, headers, body } : body),
  })
  signal.throwIfAborted()
  if (!response.ok) {
    let detail = await response.text()
    let errorCode: unknown
    try {
      const data = JSON.parse(detail)
      errorCode = data?.error?.code
      detail = data.error?.message ?? data.error ?? data.message ?? detail
      if (typeof detail !== "string") detail = JSON.stringify(detail)
    } catch {
      // A provider or proxy may return an HTML/plain-text error instead of JSON.
    }
    for (const value of Object.values(headers)) {
      const secret = value.replace(/^Bearer\s+/i, "")
      if (secret) detail = detail.replaceAll(secret, "[已隐藏密钥]")
    }
    const hint =
      response.status === 403 && errorCode === "upgrade_required"
        ? "当前套餐未开通 Provider API，请到服务方账户设置检查 API 权限。"
        : response.status === 429
          ? "请求过于频繁或额度不足，请稍后再试。"
          : response.status === 401 || response.status === 403
            ? "请检查 API Key、模型权限与地域。"
            : "请检查接口地址、模型名称和参数。"
    throw Object.assign(new Error(`接口返回 HTTP ${response.status}：${hint}${detail ? ` ${detail.slice(0, 500)}` : ""}`), {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    })
  }
  return response
}

export function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)])
}

export function requestError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return signal.reason instanceof Error ? signal.reason : new DOMException("请求已取消", "AbortError")
  if (error instanceof Error && error.name === "TimeoutError") return new Error("模型请求超时，请选择更快的模型或稍后重试。")
  if (error instanceof SyntaxError) return new Error("模型接口未返回有效 JSON，请检查接口协议或代理设置。")
  if (error instanceof TypeError) return new Error("无法连接模型接口。请检查网络；浏览器直连可能受跨域限制，可改用本地代理。")
  return error instanceof Error ? error : new Error("模型请求失败。")
}
