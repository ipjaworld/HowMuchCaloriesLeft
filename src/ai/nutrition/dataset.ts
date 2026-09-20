import { z } from "zod";
import type { FoodEntry } from "./types";

/**
 * The local food dataset: its schema, and how a user's wording is matched
 * against it.
 *
 * The dataset itself is built from the MFDS food-nutrition database. This
 * file defines the shape that ingestion has to produce, and validates it on
 * load, so a bad row can never reach the arithmetic.
 */

const servingSchema = z.object({
  unit: z.string().min(1),
  grams: z.number().positive().finite(),
});

export const foodEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  caloriesPer100g: z.number().nonnegative().finite(),
  servings: z.array(servingSchema).min(1).optional(),
  source: z.string().min(1),
});

export const foodDatasetSchema = z.object({
  version: z.literal(1),
  /** Where the figures came from, for the README and for attribution. */
  source: z.object({
    name: z.string().min(1),
    retrievedAt: z.string().min(1),
    license: z.string().min(1),
  }),
  entries: z.array(foodEntrySchema),
});

export type FoodDataset = z.infer<typeof foodDatasetSchema>;

/** Invalid rows are dropped, not fatal — one bad food should not blank the app. */
export function parseFoodEntries(entries: unknown[]): FoodEntry[] {
  const valid: FoodEntry[] = [];
  for (const entry of entries) {
    const result = foodEntrySchema.safeParse(entry);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

/** Korean particles that can trail a food name in ordinary speech. */
const TRAILING_PARTICLES = ["은", "는", "이", "가", "을", "를", "도", "만", "의"];

/** Spacing is not reliable in Korean food names: 삶은계란 / 삶은 계란. */
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * The forms of a spoken name worth looking up.
 *
 * A particle-stripped variant is only ever a *candidate*: 오이 and 포도 end
 * in what look like 이 and 도, so the dataset gets to decide which form is
 * real rather than this function guessing.
 */
export function nameVariants(spoken: string): string[] {
  const base = squash(spoken);
  const variants = new Set<string>([base]);

  for (const particle of TRAILING_PARTICLES) {
    if (base.length > particle.length && base.endsWith(particle)) {
      variants.add(base.slice(0, -particle.length));
    }
  }

  return [...variants].filter((variant) => variant.length > 0);
}

/** Below this, a match is not worth offering at all. */
export const MIN_MATCH_SCORE = 0.6;

/** Two candidates this close together are not distinguishable. */
const TIE_EPSILON = 0.001;

type Scored = { entry: FoodEntry; score: number };

function scoreEntry(entry: FoodEntry, variants: string[]): number {
  const names = [entry.name, ...(entry.aliases ?? [])].map(squash);
  let best = 0;

  for (const variant of variants) {
    // An exact hit on the first variant is the user's own wording; a hit on
    // a stripped variant is one inference away, so it scores slightly lower.
    const exactness = variant === variants[0] ? 1 : 0.95;

    for (const name of names) {
      if (name === variant) best = Math.max(best, 1 * exactness);
      else if (name.startsWith(variant)) best = Math.max(best, 0.8 * exactness);
      else if (name.includes(variant)) best = Math.max(best, 0.7 * exactness);
      else if (variant.includes(name) && name.length >= 2) {
        best = Math.max(best, 0.65 * exactness);
      }
    }
  }

  return best;
}

export type NameSearch =
  | { kind: "none" }
  | { kind: "one"; entry: FoodEntry; score: number }
  | { kind: "several"; entries: FoodEntry[]; score: number };

/**
 * Looks a spoken name up. Returns `several` rather than picking a winner when
 * the top candidates are indistinguishable — "밥" really is ambiguous, and
 * guessing between 흰쌀밥 and 현미밥 is the kind of silent wrong answer this
 * app is built to avoid.
 */
export function findByName(entries: FoodEntry[], spoken: string): NameSearch {
  const variants = nameVariants(spoken);
  if (variants.length === 0) return { kind: "none" };

  const scored: Scored[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, variants);
    if (score >= MIN_MATCH_SCORE) scored.push({ entry, score });
  }

  if (scored.length === 0) return { kind: "none" };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best === undefined) return { kind: "none" };

  const tied = scored.filter((row) => best.score - row.score <= TIE_EPSILON);
  if (tied.length === 1) return { kind: "one", entry: best.entry, score: best.score };

  return {
    kind: "several",
    entries: tied.map((row) => row.entry),
    score: best.score,
  };
}
