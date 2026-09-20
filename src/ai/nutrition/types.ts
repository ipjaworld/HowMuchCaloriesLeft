import type { ParsedFoodPhrase } from "./foodPhrases";

/**
 * The nutrition layer's vocabulary.
 *
 * The rule this whole layer exists to enforce: calorie figures are *looked
 * up*, never generated. Nothing here — and nothing that calls it — is
 * allowed to invent a number for a food. When the data does not know a food,
 * the answer is "unknown", and the app asks.
 */

/** A portion this food is normally counted in: 한 공기 = 210 g. */
export type Serving = {
  /** The counter, matching the units the quantity parser produces. */
  unit: string;
  grams: number;
};

/**
 * One food in the local dataset. Mirrors what the MFDS database publishes:
 * energy per 100 g, plus a reference serving where one is given.
 */
export type FoodEntry = {
  id: string;
  /** Canonical name, as the source publishes it. */
  name: string;
  /** Other ways people say it: 아아 for 아이스 아메리카노, 공기밥 for 흰쌀밥. */
  aliases?: string[];
  caloriesPer100g: number;
  /** Known portions. The first is the default when a count has no counter. */
  servings?: Serving[];
  /** Provenance, so a figure can always be traced back. */
  source: string;
};

export type NutritionMatch = {
  entry: FoodEntry;
  /** Calories for the parsed quantity, already scaled. */
  calories: number;
  /**
   * True when the portion had to be assumed or converted — no amount given,
   * an unfamiliar counter, or millilitres read as grams.
   */
  estimated: boolean;
  /** How well the name matched, 0-1. */
  score: number;
};

export type PhraseResolution =
  | { status: "resolved"; phrase: ParsedFoodPhrase; match: NutritionMatch }
  | {
      status: "ambiguous";
      phrase: ParsedFoodPhrase;
      candidates: NutritionMatch[];
    }
  | { status: "unknown"; phrase: ParsedFoodPhrase };

/**
 * The port. Phase 5 ships a local-dataset implementation; the MFDS OpenAPI
 * becomes a second one behind the same interface, and the LLM fallback sits
 * in front of it as a parser, never as a source of numbers.
 */
export interface NutritionResolver {
  resolve(phrase: ParsedFoodPhrase): Promise<PhraseResolution>;
}

export type { ParsedFoodPhrase };
