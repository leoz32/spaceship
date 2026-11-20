import { storedApiKey, streamCompletion } from "../llm/cerebras.ts"
import { STORY_OPENINGS } from "../story/openings.ts"
import { STORY_MAX_WORDS, STORY_REQUEST } from "../story/prompt.ts"
import { strengthLevelOf, valueOf, type Control } from "./dimension.ts"
import { readingSpans } from "./segments.ts"
import type { Steering, TextSource } from "./text-stream.ts"
import { countWords } from "./words.ts"

const STEERED_SYSTEM_PROMPT = `你是一位中文小说作者。用户消息可能包含“锁定线索”“方向控制”，以及“已有故事”。故事可能停在半句话中。

- 默认使用自然流畅的简体中文；已有故事明确使用其他语言时沿用原文语言。中文字符之间不要插入空格。
- 只输出紧接原文的新正文。若原文停在半句话中，先把它续完。不要重述、重启或重复任何已有正文，包括最后一个词。
- 锁定线索决定接下来发生什么；尤其关注 [方括号] 中的关键词。让这些词在开头两句话中自然出现。
- 方向控制决定接下来怎么写。每个方向给出名称、两端或选项、当前取值与影响强度。根据这些信息调整情节、视角与风格，不要把控制标签机械写进正文。
- 对连续刻度，极端位置要表现清楚，中间位置兼顾两端。强度“强烈”表示贯穿整段，“适中”表示明显影响，“轻微”只体现在一两个细节，不能支配整段。强度与取值是两回事；只有强烈控制才夸张表现极端取值。
- 同时存在锁定线索与方向控制时，让情节从线索发展出来，按控制要求呈现；从首句到末句保持连续。
- 只输出纯文本，不加标题、Markdown、分析或评论。
- 每次约 200 至 400 个中文字，最多 ${STORY_MAX_WORDS} 字；其他语言最多 300 词。以完整句子结束。

示例
用户：
锁定线索
不是从她的[手机]里传来的

方向控制
张力: 非常紧张（影响强度：强烈）

已有故事
铃声响了，但并不是从她的手机里传来的。林遥屏住呼吸，伸手
助手：摸向枕边。屏幕一片漆黑，衣柜里的铃声却越来越急。`

const MAX_ECHO_WORDS = 6
const STEERED_REQUEST = { ...STORY_REQUEST, system: STEERED_SYSTEM_PROMPT }

export const liveSource: TextSource = { expand: expandToStoryStart, complete: completeStory }

export function expandToStoryStart(text: string) {
  const candidates = STORY_OPENINGS.filter((start) => start.startsWith(text))
  return candidates[Math.floor(Math.random() * candidates.length)] ?? text
}

async function* completeStory(prefix: string, steering: Steering, signal: AbortSignal) {
  const apiKey = storedApiKey()
  if (!apiKey) throw new Error("请先在模型设置中填写 API Key")

  const isSteered = steering.leads.length > 0 || steering.controls.length > 0
  const request = isSteered ? { ...STEERED_REQUEST, user: steeredUserMessage(prefix, steering) } : { ...STORY_REQUEST, user: prefix }
  let head: string | undefined = ""
  for await (const delta of streamCompletion({ ...request, apiKey, signal })) {
    if (head === undefined) {
      yield delta
      continue
    }
    head += delta
    if (countWords(head) <= MAX_ECHO_WORDS) continue
    yield joinContinuation(prefix, withoutEcho(prefix, head))
    head = undefined
  }
  const rest = head && withoutEcho(prefix, head)
  if (rest) yield joinContinuation(prefix, rest)
}

/** Suppress a repeated suffix, using reading units so a Chinese paragraph is not one giant word. */
export function withoutEcho(prefix: string, head: string) {
  const start = head.trimStart()
  const prefixSpans = readingSpans(prefix)
  const tail = prefixSpans.slice(-MAX_ECHO_WORDS).map(({ start, end }) => bareWord(prefix.slice(start, end)))
  const words = readingSpans(start)
  for (let count = Math.min(tail.length, words.length); count > 0; count--) {
    const isEcho = tail.slice(-count).every((word, index) => word !== "" && word === bareWord(start.slice(words[index].start, words[index].end)))
    if (!isEcho) continue
    const echoed = start.slice(0, words[count - 1].end)
    if (count === 1 && /\p{Script=Han}/u.test(echoed)) continue
    let rest = start.slice(words[count - 1].end).trimStart()
    const punctuation = rest.match(/^[,.;:!?，。；：！？、…—”’」』）》】"')\]}]+/u)?.[0]
    if (punctuation && prefix.trimEnd().endsWith(punctuation)) rest = rest.slice(punctuation.length).trimStart()
    return rest
  }
  return start
}

/** English continuations need a word boundary; Chinese continuations do not. */
export function joinContinuation(prefix: string, continuation: string) {
  if (!continuation || !prefix || /\s$/u.test(prefix) || /^\s/u.test(continuation)) return continuation
  const needsSpace = /[\p{Script=Latin}\p{N}.,;:!?"'’”)]$/u.test(prefix) && /^[\p{Script=Latin}\p{N}"'“‘]/u.test(continuation)
  return needsSpace ? ` ${continuation}` : continuation
}

function bareWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

function steeredUserMessage(prefix: string, { leads, controls }: Steering) {
  const blocks = [
    ["锁定线索", leads.map(({ before, keyword, after }) => `${before}[${keyword}]${after}`)],
    ["方向控制", controls.map(controlLine)],
    ["已有故事", [prefix]],
  ] as const
  return blocks
    .filter(([, lines]) => lines.length)
    .map(([header, lines]) => `${header}\n${lines.join("\n")}`)
    .join("\n\n")
}

function controlLine({ dimension, position, strength }: Control) {
  const options = dimension.kind === "choice" ? `（选项：${dimension.options.join("、")}）` : ""
  const level = { slight: "轻微", moderate: "适中", strong: "强烈" }[strengthLevelOf(strength)]
  return `${dimension.name}: ${valueOf({ dimension, position })}${options}（影响强度：${level}）`
}
