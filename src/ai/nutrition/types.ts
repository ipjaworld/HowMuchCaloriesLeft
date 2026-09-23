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
   * The amount this was actually counted as, ready to display: "1개" for a
   * bare "계란", or the user's own "한 공기" when they said one.
   *
   * Always shown. An assumption the user cannot see is one they cannot
   * correct, and correcting it is the whole interaction this app is built on.
   */
  amount: { value: number; unit: string | null; text: string };
  /**
   * True when the portion had to be assumed or converted — no amount given,
   * an unfamiliar counter, or millilitres read as grams.
   */
  estimated: boolean;
  /** How well the name matched, 0-1. */
  score: number;
};

/**
 * Why a food we recognise still cannot be counted.
 *
 * Only one cause exists today, and it is deliberately named rather than
 * folded into a bare `unmeasurable`: an unfamiliar counter does *not* land
 * here, because `toGrams` falls back to the entry's natural portion and
 * flags the result `estimated`. The single way to end up with no number at
 * all is an entry that states no portion at any counter.
 */
export type UnmeasurableReason = "missing_serving";

/**
 * Four outcomes, because "we don't know" splits into two answers that call
 * for completely different replies:
 *
 *   unknown       the food is not in the dataset at all. Nothing the user
 *                 can say will price it — 마라탕.
 *   unmeasurable  the food is known and its energy is known, but the data
 *                 states no weight for the portion asked about. "커피 한잔"
 *                 lands here, and "커피 200ml" resolves, so the user can fix
 *                 it in one word — but only if the app tells them so.
 *
 * Collapsing these into one status makes the app claim it does not know a
 * food it does know, and hides the fix from the person who could apply it.
 */
export type PhraseResolution =
  | { status: "resolved"; phrase: ParsedFoodPhrase; match: NutritionMatch }
  | {
      status: "ambiguous";
      phrase: ParsedFoodPhrase;
      candidates: NutritionMatch[];
    }
  | {
      status: "unmeasurable";
      phrase: ParsedFoodPhrase;
      /**
       * The matching foods. Usually one; several when the name is ambiguous
       * *and* none of the matches can be weighed — adding more 삼각김밥
       * flavours, none of which state a per-piece weight, produces exactly
       * that. Never empty.
       */
      entries: FoodEntry[];
      reason: UnmeasurableReason;
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
