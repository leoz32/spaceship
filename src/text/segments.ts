export type Span = { start: number; end: number }

const wordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" })
const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Semantic words for attention highlights; all offsets are UTF-16 DOM offsets. */
export function wordSpans(text: string): Span[] {
  const unwrapped = unwrapCjkLines(text)
  return [...wordSegmenter.segment(unwrapped.text)]
    .filter(({ isWordLike }) => isWordLike)
    .map(({ index, segment }) => ({ start: unwrapped.offsets[index], end: unwrapped.offsets[index + segment.length - 1] + 1 }))
}

/** Join CJK soft wraps for language analysis, retaining a map back to the displayed UTF-16 text. */
export function unwrapCjkLines(text: string) {
  const characters = [...text]
  const offsets: number[] = []
  let unwrapped = ""
  let original = 0
  for (const [index, character] of characters.entries()) {
    const lineBreak = character === "\n" || character === "\r"
    const previous = characters[index - (characters[index - 1] === "\r" ? 2 : 1)] ?? ""
    const next = characters[index + (characters[index + 1] === "\n" ? 2 : 1)] ?? ""
    if (!lineBreak || (!cjk.test(previous) && !cjk.test(next))) {
      unwrapped += character
      for (let unit = 0; unit < character.length; unit++) offsets.push(original + unit)
    }
    original += character.length
  }
  return { text: unwrapped, offsets }
}

/** Stable reading units: a CJK character, or a word in other scripts. These are not model tokens. */
export function readingSpans(text: string): Span[] {
  const spans: Span[] = []
  let runStart = 0
  for (const { index, segment } of graphemeSegmenter.segment(text)) {
    if (!cjk.test(segment)) continue
    appendWords(runStart, index)
    spans.push({ start: index, end: index + segment.length })
    runStart = index + segment.length
  }
  appendWords(runStart, text.length)
  return spans

  function appendWords(start: number, end: number) {
    const run = text.slice(start, end)
    if (!/[\p{L}\p{N}]/u.test(run)) return
    for (const { index, segment, isWordLike } of wordSegmenter.segment(run)) {
      if (isWordLike) spans.push({ start: start + index, end: start + index + segment.length })
    }
  }
}

const sentenceSegmenter = new Intl.Segmenter("zh-CN", { granularity: "sentence" })

/** Ignore visual line breaks when finding sentences, while retaining the displayed text's UTF-16 offsets. */
export function sentenceSpans(text: string): Span[] {
  return [...sentenceSegmenter.segment(text.replace(/[\r\n]/g, " "))].map(({ index, segment }) => ({ start: index, end: index + segment.length }))
}
