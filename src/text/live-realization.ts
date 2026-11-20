import { createDecisions, type Question } from "../llm/decisions.ts"
import type { RealizationSource } from "./realization.ts"

const MODEL = "gemini-decision-1"

export const liveRealization: RealizationSource = async function* ({ context, sentences, asked, control }, signal) {
  const input = [
    ...(context ? [`已有故事\n${context}`] : []),
    `候选句子\n${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join("\n")}`,
    `方向控制\n${control}`,
  ].join("\n\n")
  const questions = Object.fromEntries(asked.map((index) => [keyOf(index), questionAbout(index)]))
  const { answers } = await createDecisions(undefined, { model: MODEL, input, questions }, signal)

  for (const index of asked) {
    const answer = answers[keyOf(index)]
    if (answer?.type === "noul") yield { index, confidence: answer.noul }
  }
}

function keyOf(index: number) {
  return `s${index + 1}`
}

function questionAbout(index: number): Question {
  return {
    type: "noul",
    instructions: `句子 [${index + 1}] 是否体现了方向控制要求的取值？`,
    criteria: {
      true_description: "这句话清楚地体现了方向控制的取值。",
      false_description: "这句话没有体现该取值，或呈现了相反方向。",
    },
  }
}
