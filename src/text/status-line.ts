import type { StreamActivity } from "./text-stream.ts"

/** What the model is doing, and what the text holds and is steered by; `buffer` counts the generated words waiting past the knob. */
export type Status = StreamActivity & { words: number; buffer: number; boxes: number; steering: number; pinned: number }

/**
 * Writes `status` into `element` as three zones: what the model is doing, what the text holds, and what steers it.
 * Whether the model is streaming is marked on `element`, for the readings to show it. Model and text fields are labelled by a glyph that spells out its name on hover; a field not measured yet reads as a dash.
 */
export function showStatus(element: HTMLElement, { isGenerating, firstChunkMs, wordsPerSecond, words, buffer, boxes, steering, pinned }: Status) {
  element.toggleAttribute("data-streaming", isGenerating)
  element.replaceChildren(
    zone(
      field(
        "rate",
        glyph("»", "生成速度：中文按字，英文按词；不是 API token"),
        wordsPerSecond === undefined ? undefined : `${Math.round(wordsPerSecond)}`,
        "字词/秒",
      ),
      field("latency", glyph("▼", "首段文本等待时间"), firstChunkMs === undefined ? undefined : `${Math.round(firstChunkMs)}`, "ms"),
    ),
    zone(field("words", glyph("¶", "已显示字/词；加号后为预生成的字/词数"), `${words}`, `+${buffer}`)),
    zone(field("boxes", "重点", `${boxes}`), field("steering", "方向", `${steering}`), field("pinned", "固定", `${pinned}`)),
  )
}

function zone(...fields: HTMLElement[]) {
  const span = document.createElement("span")
  span.className = "zone"
  span.append(...fields)
  return span
}

function field(name: string, label: string | Node, value?: string, suffix?: string) {
  const span = document.createElement("span")
  span.dataset.field = name
  const reading = Object.assign(document.createElement("b"), { textContent: value ?? "—" })
  if (value !== undefined && suffix) reading.append(Object.assign(document.createElement("small"), { textContent: suffix }))
  span.append(label, reading)
  return span
}

function glyph(symbol: string, name: string) {
  return Object.assign(document.createElement("abbr"), { textContent: symbol, title: name })
}
