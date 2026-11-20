import { readingSpans } from "./segments.ts"
export { readingSpans } from "./segments.ts"

const TRAILING_PUNCTUATION = /^[,.;:!?，。；：！？、…—”’」』）》】〉〕〗〙〛"')\]}]*/u

export function countWords(text: string) {
  return readingSpans(text).length
}

/** Keeps punctuation belonging to the last visible unit; never splits a Unicode grapheme. */
export function firstWords(text: string, count: number) {
  if (count < 1) return ""
  const spans = readingSpans(text)
  if (count >= spans.length) return text
  const last = spans[Math.floor(count) - 1]
  const next = spans[Math.floor(count)]
  const punctuation = text.slice(last.end, next.start).match(TRAILING_PUNCTUATION)?.[0] ?? ""
  return text.slice(0, last.end + punctuation.length)
}
