import assert from "node:assert/strict"
import test from "node:test"
import { STORY_OPENINGS } from "../src/story/openings.ts"
import { simulatedSource } from "../src/text/completion.ts"
import { attentionBoxFromLine } from "../src/text/live-attention.ts"
import { expandToStoryStart, joinContinuation, withoutEcho } from "../src/text/live-completion.ts"
import { readingSpans, sentenceSpans, wordSpans } from "../src/text/segments.ts"
import { displayedPrefixEnd, isComplete, storyLayoutOf } from "../src/text/story-layout.ts"
import { createTextStream, type Steering } from "../src/text/text-stream.ts"
import { countWords, firstWords } from "../src/text/words.ts"

const steering: Steering = { leads: [], controls: [] }

test("中文计数按字，英文按词，保留中文标点", () => {
  assert.equal(countWords("月光下，Elara 推开门。"), 7)
  assert.equal(firstWords("月光下，Elara 推开门。", 3), "月光下，")
  assert.equal(firstWords("月光下，Elara 推开门。", 4), "月光下，Elara")
  assert.equal(firstWords("月光下，Elara 推开门。", 20), "月光下，Elara 推开门。")
  assert.equal(firstWords("月光下。", 0), "")
  assert.equal(firstWords("Hello, world!", 1), "Hello,")
})

test("组合字符和扩展汉字保持完整 UTF-16 范围", () => {
  const text = "𠀀与cafe\u0301相遇。"
  assert.equal(countWords(text), 5)
  assert.equal(firstWords(text, 1), "𠀀")
  assert.deepEqual(
    readingSpans(text).map(({ start, end }) => text.slice(start, end)),
    ["𠀀", "与", "cafe\u0301", "相", "遇"],
  )
})

test("中文折行不插空格、不丢待生成文本，显示和高亮的偏移一致", () => {
  const full = "月光落在古堡上。艾拉推开门，停了下来。"
  const story = storyLayoutOf(["月光落在", "古堡上。艾拉"], full)
  assert.equal(story.text, "月光落在\n古堡上。艾拉")
  assert.equal(story.content, story.text)
  assert.equal(story.combined, "月光落在\n古堡上。艾拉推开门，停了下来。")
  assert.equal(displayedPrefixEnd(["月光落在", "古堡上。艾拉"], full), "月光落在古堡上。艾拉".length)
  assert.equal(story.sentences.length, 2)
  assert.ok(isComplete(story, 0))
  assert.ok(isComplete(story, 1))
  assert.equal(sentenceSpans("月光落在\n古堡上。").length, 1)
})

test("英文折行还原正确尾部，不重复相同单词", () => {
  const story = storyLayoutOf(["The door", "was still"], "The door was still locked, and quiet.")
  assert.equal(story.combined, "The door\nwas still locked, and quiet.")
  assert.equal(displayedPrefixEnd([], "The door"), 0)
})

test("中文续写无需空格，英文续写保留词边界", () => {
  assert.equal(joinContinuation("艾拉伸手", "推开门。"), "推开门。")
  assert.equal(joinContinuation("The door was still", "locked."), " locked.")
  assert.equal(joinContinuation("Hello", ", world!"), ", world!")
  assert.equal(withoutEcho("艾拉走进古堡，", "古堡，里面一片漆黑。"), "里面一片漆黑。")
  assert.equal(withoutEcho("The door was still", "still locked, and quiet."), "locked, and quiet.")
  assert.equal(withoutEcho("她想了想", "想起了昨日的约定。"), "想起了昨日的约定。")
})

test("故事开头扩展保留已有中文前缀", () => {
  const opening = STORY_OPENINGS[0]
  assert.equal(expandToStoryStart(opening.slice(0, 5)), opening)
  assert.equal(expandToStoryStart("这是我自己的故事"), "这是我自己的故事")
})

test("关键词按原文位置定位，支持中文软换行并拒绝编造短语", () => {
  const text = "月光下，艾拉握紧钥\n匙，推开古堡的大门。"
  const box = attentionBoxFromLine("艾拉握紧[钥匙]", text)
  assert.ok(box)
  const spans = wordSpans(text)
  assert.equal(text.slice(spans[box.keyword].start, spans[box.keyword].end), "钥")
  assert.ok(box.after >= 1)
  assert.equal(attentionBoxFromLine("艾拉找到了[宝藏]", text), undefined)
})

test("中文模拟生成可离线续写且不插入英文分词空格", async () => {
  const controller = new AbortController()
  const chunks: string[] = []
  for await (const chunk of simulatedSource.complete("", steering, controller.signal)) {
    chunks.push(chunk)
    if (chunks.length === 3) break
  }
  const text = chunks.join("")
  assert.ok(/\p{Script=Han}/u.test(text))
  assert.ok(!text.includes(" "))
  assert.ok(!text.includes("Lorem"))
})

test("流式中文截断保留字符与标点，旧请求不会写回", async () => {
  let oldFinished: (() => void) | undefined
  let call = 0
  const stream = createTextStream(
    {
      async *complete() {
        if (++call === 1) {
          yield "月光下，艾拉"
          await new Promise<void>((resolve) => {
            oldFinished = resolve
          })
          yield "旧剧情"
        } else yield "走进古堡。"
      },
    },
    () => {},
  )
  const first = stream.generate("buffer low", steering)
  await stream.streaming()
  const replacement = stream.regenerate(3, "steering changed", steering)
  oldFinished!()
  assert.equal(await first, "aborted")
  assert.equal(await replacement, "done")
  assert.equal(stream.text, "月光下，走进古堡。")
})

test("生成取消后，等待首块的任务得到释放", async () => {
  let finish: (() => void) | undefined
  const stream = createTextStream(
    {
      async *complete() {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        yield "已取消"
      },
    },
    () => {},
  )
  const generation = stream.generate("buffer low", steering)
  const waiting = stream.streaming()
  stream.truncate(0)
  await waiting
  finish!()
  assert.equal(await generation, "aborted")
  assert.equal(stream.text, "")
})
