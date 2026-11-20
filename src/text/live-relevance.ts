import { createDecisions, storedGeminiKey, type Question } from "../llm/decisions.ts"
import type { RelevanceSource } from "./keyword-relevance.ts"

const MODEL = "gemini-decision-1"
const LEVELS = ["没有关联", "较弱：有共同背景或次要细节", "适中：与当前句子描述的内容有关", "较强：当前句子直接围绕该词展开，或以它为转折点"]

export const liveRelevance: RelevanceSource = async function* ({ story, tip, leads }, signal) {
  const apiKey = storedGeminiKey()
  if (!apiKey) throw new Error("请先在模型设置中配置分析模型")

  const input = [
    ...(story ? [`已有故事\n${story}`] : []),
    `当前正在写的句子\n${tip}`,
    `关键词\n${leads.map(({ before, keyword, after }, i) => `[${i + 1}] ${keyword} （所在短语：${before}${keyword}${after}）`).join("\n")}`,
  ].join("\n\n")
  const questions = Object.fromEntries(
    leads.map((lead, i): [string, Question] => [
      keyOf(i),
      { type: "score", instructions: `关键词 [${i + 1}]“${lead.keyword}”与当前正在写的句子有多大关联？`, criteria: LEVELS },
    ]),
  )
  const { answers } = await createDecisions(apiKey, { model: MODEL, input, questions }, signal)

  for (const index of leads.keys()) {
    const answer = answers[keyOf(index)]
    if (answer?.type === "score") yield { index, relevance: answer.score / (LEVELS.length - 1) }
  }
}

function keyOf(index: number) {
  return `k${index + 1}`
}
