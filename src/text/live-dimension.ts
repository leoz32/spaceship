import { streamCompletion } from "../llm/cerebras.ts"
import type { Dimension, DimensionContext, DimensionSource } from "./dimension.ts"

const MENU_SIZE = 5
const CHARACTERS_SLOT = "<人物>"

const CATALOG: Dimension[] = [
  { name: "张力", kind: "scale", low: "轻松", high: "紧张" },
  { name: "解谜", kind: "scale", low: "悬而未决", high: "揭晓答案" },
  { name: "节奏", kind: "scale", low: "简洁推进", high: "细致展开" },
  { name: "表达", kind: "choice", options: ["对话", "动作", "描写"] },
  { name: "焦点", kind: "choice", options: [] },
  { name: "氛围", kind: "choice", options: ["诙谐", "温柔", "沉郁", "奇妙"] },
  { name: "距离", kind: "scale", low: "外部观察", high: "内心体验" },
  { name: "际遇", kind: "scale", low: "逐渐恶化", high: "逐渐好转" },
  { name: "转折", kind: "scale", low: "意料之中", high: "出人意料" },
]

const SYSTEM_PROMPT = `用户消息包含已有故事、可选的锁定线索（关键词在方括号内）以及可供选择的方向。每个方向都能改变后续一小段故事的写法，格式为“名称: 选项 | 选项”。

按要求的数量，选择此刻最有意义的方向，最重要的排在前面。有锁定线索时优先选择能影响这些线索的方向。逐行原样返回所选方向，不加任何解释。

唯一例外是“焦点”：将 <人物> 替换为故事中已出现的人物，使用姓名或简短称谓，再保留“叙述者”选项。总选项数为 2 至 4 个，每个中文标签不超过 12 字。故事尚无人物时不选焦点。

示例
用户：
故事：艾拉推开古堡大门，发现父亲留下的信不见了。
方向：
张力: 轻松 | 紧张
节奏: 简洁推进 | 细致展开
表达: 对话 | 动作 | 描写
焦点: <人物> | 叙述者
际遇: 逐渐恶化 | 逐渐好转
选择 3 个。
助手：
张力: 轻松 | 紧张
焦点: 艾拉 | 父亲 | 叙述者
表达: 对话 | 动作 | 描写`

export const liveDimension: DimensionSource = async function* (context, signal) {
  const takenNames = context.taken.map(({ name }) => name.toLowerCase())
  const free = CATALOG.filter(({ name }) => !takenNames.includes(name))
  const generic = free.filter((axis) => axis.kind === "scale" || axis.options.length)
  const size = Math.min(MENU_SIZE, generic.length)
  if (!size) return

  const offered: string[] = []
  const deltas = streamCompletion({
    role: "analysis",
    system: SYSTEM_PROMPT,
    user: userMessageOf(context, free, size),
    temperature: 0.3,
    maxCompletionTokens: 1500,
    signal,
  })
  for await (const line of linesOf(deltas)) {
    const dimension = dimensionOf(line, free)
    if (!dimension || offered.includes(dimension.name)) continue
    offered.push(dimension.name)
    yield dimension
    if (offered.length === size) return
  }
  yield* generic.filter(({ name }) => !offered.includes(name)).slice(0, size - offered.length)
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

function userMessageOf({ text, leads }: DimensionContext, free: Dimension[], size: number) {
  const keyPhrases = leads.length ? `锁定线索：\n${leads.map(({ before, keyword, after }) => `- ${before}[${keyword}]${after}`).join("\n")}\n` : ""
  return `故事：${text}\n${keyPhrases}方向：\n${free.map(axisLine).join("\n")}\n选择 ${size} 个。`
}

function axisLine(axis: Dimension) {
  if (axis.kind === "scale") return `${axis.name}: ${axis.low} | ${axis.high}`
  return `${axis.name}: ${axis.options.length ? axis.options.join(" | ") : `${CHARACTERS_SLOT} | 叙述者`}`
}

function dimensionOf(line: string, axes: Dimension[]): Dimension | undefined {
  const [name, rest] = line.split(/[:：]/u, 2).map((part) => part.trim())
  const axis = axes.find((axis) => axis.name === name.toLowerCase())
  const labels = (rest ?? "").split("|").map(plainLabel)
  if (!axis || !labels.every(isValidLabel)) return

  if (axis.kind === "scale") return labels.length === 2 ? { name: axis.name, kind: "scale", low: labels[0], high: labels[1] } : undefined
  return labels.length >= 2 && labels.length <= 4 ? { name: axis.name, kind: "choice", options: labels } : undefined
}

function plainLabel(label: string) {
  return label
    .replace(/[（(].*?[）)]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isValidLabel(label: string) {
  if (!label || label === CHARACTERS_SLOT) return false
  return /\p{Script=Han}/u.test(label) ? [...label].length <= 12 : label.split(/\s+/u).length <= 3
}
