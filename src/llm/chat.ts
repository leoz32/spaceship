import { streamCompletion } from "./cerebras.ts"
import type { ModelProfile } from "./settings.ts"

export async function probeModel(profile: ModelProfile, transport: "proxy" | "direct", signal: AbortSignal): Promise<{ firstChunkMs: number; sample: string }> {
  const started = performance.now()
  let firstChunkMs = 0
  let sample = ""
  for await (const delta of streamCompletion({
    profile,
    transport,
    signal,
    system: "这是一次接口连接测试，请用简体中文回答。",
    user: "只回复：连接成功",
    temperature: 0.1,
    maxCompletionTokens: profile.provider === "commandcode" ? 256 : 64,
  })) {
    if (!sample) firstChunkMs = Math.round(performance.now() - started)
    sample += delta
    if (sample.length >= 64) break
  }
  return { firstChunkMs, sample: sample.slice(0, 64) }
}
