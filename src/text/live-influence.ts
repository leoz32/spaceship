import { createDecisions, storedGeminiKey, type Question } from "../llm/decisions.ts"
import type { Focus, InfluenceSource } from "./influence.ts"

const MODEL = "gemini-decision-1"

const QUESTIONS: Record<Focus["kind"], { instructions: string; levels: string[] }> = {
  "next sentence": {
    instructions: "与【下一句】有关，并推动它的发展",
    levels: ["没有关联", "较弱：有共同的细节或背景", "适中：下一句建立在这句话的基础上", "较强：下一句由这句话直接引出"],
  },
  "key phrase": {
    instructions: "与【关键词组】所指的事物、起因或后果有关",
    levels: ["没有关联", "较弱：有共同的细节或背景", "适中：涉及关键词组所指的内容", "较强：直接描述关键词组，或与它有直接因果关系"],
  },
}

export const liveInfluence: InfluenceSource = async function* (sentences, focus, signal) {
  const apiKey = storedGeminiKey()
  if (!apiKey) throw new Error("请先在模型设置中配置分析模型")

  const { instructions, levels } = QUESTIONS[focus.kind]
  const input = `故事句子\n${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join("\n")}\n\n${focus.kind === "next sentence" ? "下一句" : "关键词组"}\n${focus.text}`
  const questions = Object.fromEntries(
    sentences.map((_, i): [string, Question] => [keyOf(i), { type: "score", instructions: `句子 [${i + 1}] 在多大程度上${instructions}？`, criteria: levels }]),
  )
  const { answers } = await createDecisions(apiKey, { model: MODEL, input, questions }, signal)

  for (const index of sentences.keys()) {
    const answer = answers[keyOf(index)]
    if (answer?.type === "score") yield { index, strength: answer.score / (levels.length - 1) }
  }
}

function keyOf(index: number) {
  return `s${index + 1}`
}
