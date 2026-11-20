import { STORY_OPENINGS } from "../story/openings.ts"
import { optionIndexAt } from "./dimension.ts"
import type { Steering, TextSource } from "./text-stream.ts"

const LATENCY_MS = 150
const CHUNK_INTERVAL_MS = 20
const CHARACTERS_PER_CHUNK = 12
const SENTENCES_PER_COMPLETION = 14

const SENTENCES = [
  "风从门缝里挤进来，吹动她手中那张泛黄的地图。",
  "走廊尽头亮着一盏小灯，灯下的影子却朝着相反的方向移动。",
  "她认出了石墙上的刻痕，那是父亲教她写下的第一个字。",
  "远处传来钟声，比约定的时间早了一刻。",
  "艾拉把钥匙放进锁孔，听见门后有人轻轻叹了口气。",
  "尘封的房间里摆着两只茶杯，其中一只还冒着热气。",
  "她没有立刻开口，只把口袋里的信放在了桌上。",
  "窗外的云慢慢散开，一条通往庭院的小路显露出来。",
  "守门人抬起头，仿佛早已知道她会在今夜到来。",
  "那段被她忘记的旋律，又从楼梯深处轻轻响起。",
  "她伸手碰了碰墙上的画，指尖沾到了一点尚未干透的颜料。",
  "穿过最后一道拱门时，她忽然明白，地图上的终点只是另一个开始。",
]

export const simulatedSource: TextSource = {
  expand: (text) => text || STORY_OPENINGS[0],
  complete,
}

/** A local demonstration, with canned prose and visible steering cues; it does not call a model. */
async function* complete(_prefix: string, steering: Steering, signal: AbortSignal) {
  const steered = steeringSentences(steering)
  const start = Math.floor(Math.random() * SENTENCES.length)
  const passage = Array.from({ length: SENTENCES_PER_COMPLETION }, (_, index) =>
    steered.length && index % 3 === 0 ? steered[Math.floor(index / 3) % steered.length] : SENTENCES[(start + index) % SENTENCES.length],
  ).join("")
  const characters = [...passage]
  for (let at = 0; at < characters.length; at += CHARACTERS_PER_CHUNK) {
    await delay(at === 0 ? LATENCY_MS : CHUNK_INTERVAL_MS, signal)
    yield characters.slice(at, at + CHARACTERS_PER_CHUNK).join("")
  }
}

function steeringSentences({ leads, controls }: Steering) {
  return [
    ...leads.map(({ keyword }) => `艾拉想起了“${keyword}”，她决定沿着这条线索继续寻找。`),
    ...controls.flatMap(({ dimension, position, strength }) => {
      if (strength < 1 / 3 && Math.random() > strength) return []
      const value =
        dimension.kind === "choice" ? dimension.options[optionIndexAt(dimension.options.length, position)] : position < 0.5 ? dimension.low : dimension.high
      if (/紧张|紧绷|惊险|strained/.test(value)) return ["门后猛地响起脚步声，她攥紧钥匙，连呼吸也放轻了。"]
      if (/平静|轻松|松弛|relaxed/.test(value)) return ["她在窗边坐下，慢慢喝完了那杯温热的茶。"]
      if (/温柔|温暖|tender/.test(value)) return ["守门人替她拂去肩上的雨水，像多年以前那样轻声唤她的名字。"]
      if (/幽默|诙谐|wry/.test(value)) return ["守门人打了个喷嚏，庄严的气氛顿时少了一半，他只好假装整理领口。"]
      if (/忧郁|沉郁|somber/.test(value)) return ["空椅子还摆在原处，她却再也等不到那个熟悉的人坐下来。"]
      if (/奇幻|惊奇|奇妙|wondrous/.test(value)) return ["墙上的星图忽然漂浮起来，整座房间像一片缓缓转动的夜空。"]
      if (/对话|dialogue/.test(value)) return ["“你终于来了。”守门人说。“我一直在等你问出那个问题。”"]
      if (/动作|action/.test(value)) return ["艾拉侧身闪过落下的木梁，一把抓住栏杆，跃上了平台。"]
      if (/描写|description/.test(value)) return ["铜灯罩上刻着细密的叶纹，柔和的光在桌面铺开一圈浅浅的金色。"]
      if (/内心|inside/.test(value)) return ["她终于承认，自己害怕的并不是那扇门，而是门后可能出现的答案。"]
      return [`想到“${value}”所指向的可能，艾拉停下脚步，重新打量眼前的选择。`]
    }),
  ]
}

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}
