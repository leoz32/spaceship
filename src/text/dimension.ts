import type { Lead } from "./attention.ts"

/** An aspect of the upcoming text that a future knob tunes: a two-pole scale, or a choice among options. */
export type Dimension = { name: string } & ({ kind: "scale"; low: string; high: string } | { kind: "choice"; options: string[] })

/** A dimension with the knob's position across the fan (0 is the low pole or first option, 1 the high pole or last) and its strength of influence, both from 0 to 1. */
export type Control = { dimension: Dimension; position: number; strength: number }

export type DimensionContext = { text: string; leads: Lead[]; taken: Dimension[] }

/** Streams the dimensions offered for `context.text`, most relevant first: each differs from the others and from every one in `context.taken`. Must stop (by throwing or returning) once `signal` aborts. */
export type DimensionSource = (context: DimensionContext, signal: AbortSignal) => AsyncIterable<Dimension>

export type StrengthLevel = "slight" | "moderate" | "strong"

/** The fan is split into `optionCount` equal sectors; returns the one containing `position`. */
export function optionIndexAt(optionCount: number, position: number) {
  return Math.min(optionCount - 1, Math.floor(position * optionCount))
}

/** Index 0–4 of the five grades a scale position is spoken as: very low, somewhat low, midway, somewhat high, very high. */
export function gradeIndexOf(position: number) {
  if (position < 0.2) return 0
  if (position < 0.4) return 1
  if (position <= 0.6) return 2
  if (position <= 0.8) return 3
  return 4
}

/** The control's value in words: a scale's grade, e.g. "very calm", "somewhat tense", "midway between calm and tense"; or a choice's selected option. */
export function valueOf({ dimension, position }: Pick<Control, "dimension" | "position">) {
  if (dimension.kind === "choice") return dimension.options[optionIndexAt(dimension.options.length, position)]
  const { low, high } = dimension
  return [`非常${low}`, `偏向${low}`, `${low}与${high}之间`, `偏向${high}`, `非常${high}`][gradeIndexOf(position)]
}

/** Thirds of the strength range. */
export function strengthLevelOf(strength: number): StrengthLevel {
  if (strength < 1 / 3) return "slight"
  if (strength < 2 / 3) return "moderate"
  return "strong"
}
