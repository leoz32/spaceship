export type Span = { start: number; end: number }

const wordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" })
const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Semantic words for attention highlights; all offsets are UTF-16 DOM offsets. */
export function wordSpans(text: string): Span[] {
  return [...wordSegmenter.segment(text)].filter(({ isWordLike }) => isWordLike).map(({ index, segment }) => ({ start: index, end: index + segment.length }))
}

/** Stable reading units: a CJK character, or a word in other scripts. These are not model tokens. */
export function readingSpans(text: string): Span[] {
  const spans: Span[] = []
  for (const { index, segment, isWordLike } of wordSegmenter.segment(text)) {
    if (!isWordLike) continue
    if (!cjk.test(segment)) {
      spans.push({ start: index, end: index + segment.length })
      continue
    }
    for (const part of graphemeSegmenter.segment(segment)) spans.push({ start: index + part.index, end: index + part.index + part.segment.length })
  }
  return spans
}

const sentenceSegmenter = new Intl.Segmenter("zh-CN", { granularity: "sentence" })

/** Ignore visual line breaks when finding sentences, while retaining the displayed text's UTF-16 offsets. */
export function sentenceSpans(text: string): Span[] {
  return [...sentenceSegmenter.segment(text.replace(/[\r\n]/g, " "))].map(({ index, segment }) => ({ start: index, end: index + segment.length }))
}
