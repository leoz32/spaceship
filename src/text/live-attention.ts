import { storedApiKey, streamCompletion } from "../llm/cerebras.ts"
import type { AttentionBox, AttentionSource } from "./attention.ts"
import { wordSpans } from "./segments.ts"

const MAX_BOXES = 3

const SYSTEM_PROMPT = `用户消息是一段故事，停在读者当前的位置。找出最能影响下一句内容的已有关键短语。

- 选择 1 至 3 个短语；只有一个主要线索时只给一个。
- 每个短语必须逐字摘自原文连续片段，不可改字、补字、预测未来内容或跳过文字。中文短语约 4 至 20 字，英文短语 2 至 8 词。
- 用半角 [方括号] 标记短语中最重要的一个词。中文可以是双字词、人名或完整名词，不要拆开它。
- 每行只输出一个短语，不加编号、解释或 Markdown。排版换行可以忽略。

示例
用户：艾拉推开城堡大门，发现父亲留下的信不见了。她握紧钥匙，听见走廊深处
助手：
父亲留下的[信]不见了
她握紧[钥匙]
听见[走廊]深处`

export const liveAttention: AttentionSource = async function* (text, signal) {
  const apiKey = storedApiKey()
  if (!apiKey) throw new Error("请先在模型设置中填写 API Key")

  const yielded = new Set<number>()
  const deltas = streamCompletion({ apiKey, system: SYSTEM_PROMPT, user: text, temperature: 0.3, maxCompletionTokens: 1000, signal })

  for await (const line of linesOf(deltas)) {
    const box = attentionBoxFromLine(line, text)
    if (!box || yielded.has(box.keyword)) continue
    yielded.add(box.keyword)
    yield box
    if (yielded.size >= MAX_BOXES) return
  }
}

async function* linesOf(deltas: AsyncIterable<string>) {
  let buffer = ""
  for await (const delta of deltas) {
    const lines = (buffer + delta).split("\n")
    buffer = lines.pop()!
    yield* lines
  }
  yield buffer
}

/** Match the quoted source text first, then map bracket positions to semantic words. Context-sensitive CJK segmentation cannot safely be matched as isolated word arrays. */
export function attentionBoxFromLine(line: string, text: string): AttentionBox | undefined {
  const open = line.indexOf("[")
  const close = line.indexOf("]", open)
  if (open === -1 || close <= open + 1) return
  const phrase = line.slice(0, open) + line.slice(open + 1, close) + line.slice(close + 1)
  const compact = compactWithOffsets(text)
  const quoted = compactWithOffsets(phrase).text
  const at = compact.text.lastIndexOf(quoted)
  if (!quoted || at === -1) return
  const keywordOffset = compactWithOffsets(line.slice(0, open)).text.length
  const keywordLength = compactWithOffsets(line.slice(open + 1, close)).text.length
  if (!keywordLength) return
  const phraseStart = compact.offsets[at]
  const phraseEnd = compact.offsets[at + quoted.length - 1] + 1
  const keywordStart = compact.offsets[at + keywordOffset]
  const keywordEnd = compact.offsets[at + keywordOffset + keywordLength - 1] + 1
  const words = wordSpans(text)
  const first = words.findIndex((word) => word.end > phraseStart)
  const last = words.findLastIndex((word) => word.start < phraseEnd)
  const keyword = words.findIndex((word) => word.end > keywordStart && word.start < keywordEnd)
  if (first === -1 || keyword < first || keyword > last) return
  return { keyword, before: keyword - first, after: last - keyword }
}

function compactWithOffsets(text: string) {
  const offsets: number[] = []
  let compact = ""
  for (let index = 0; index < text.length; index++) {
    if (/\s/u.test(text[index])) continue
    offsets.push(index)
    compact += text[index] === "’" ? "'" : text[index]
  }
  return { text: compact, offsets }
}
