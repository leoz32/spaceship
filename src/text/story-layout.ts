import { sentenceSpans, unwrapCjkLines, type Span } from "./segments.ts"

const SENTENCE_END = /[.!?…。！？]["'”’」』）)\]】》〉]*$/u

/** Displayed and logical text share UTF-16 offsets, including soft line breaks. */
export type StoryLayout = { content: string; text: string; combined: string; sentences: Span[] }

export function storyLayoutOf(lines: string[], fullText: string): StoryLayout {
  const content = lines.join("\n")
  const upcoming = fullText.slice(displayedPrefixEnd(lines, fullText))
  const combined = content + upcoming
  return { content, text: content, combined, sentences: sentenceSpans(combined) }
}

/** Locate the shown prefix in the source, allowing only layout-collapsed whitespace. */
export function displayedPrefixEnd(lines: string[], fullText: string) {
  let offset = 0
  for (const line of lines) {
    for (const character of line) {
      if (/\s/u.test(character)) {
        while (offset < fullText.length && /\s/u.test(fullText[offset])) offset++
        continue
      }
      while (offset < fullText.length && /\s/u.test(fullText[offset])) offset++
      if (!fullText.startsWith(character, offset)) return offset
      offset += character.length
    }
  }
  return offset
}

export function isComplete({ combined, sentences }: StoryLayout, index: number) {
  return index < sentences.length - 1 || SENTENCE_END.test(sentenceAt(combined, sentences[index]))
}

export function sentenceUnderKnob({ text, combined, sentences }: StoryLayout) {
  const knobAt = text.trimEnd().length
  return sentences.findIndex((sentence) => endOf(combined, sentence) >= knobAt)
}

export function endOf(text: string, { start, end }: Span) {
  return start + text.slice(start, end).trimEnd().length
}

export function sentenceAt(text: string, { start, end }: Span) {
  return unwrapCjkLines(text.slice(start, end)).text.trim().replace(/\s+/g, " ")
}
