import type { ParsedFoodPhrase } from "./foodPhrases";

/**
 * The nutrition layer's vocabulary.
 *
 * The rule this whole layer exists to enforce: calorie figures are *looked
 * up*, never generated. Nothing here — and nothing that calls it — is
 * allowed to invent a number for a food. When the data does not know a food,
 * the answer is "unknown", and the app asks.
 */

/**
 * Where the weight of one portion came from.
 *
 * The weight of "한 개" is a different fact from the energy of 100 g, and it
 * often has to come from a different place: MFDS publishes a 갈비탕's bowl
 * but not an egg's. So a portion carries its own provenance.
 *
 *   mfds       the row itself states it (Z10500 / NUTRI_AMOUNT_SERVING).
 *              Absent `basis` means this, which is what every portion in
 *              `data/korean-foods.json` is.
 *   reference  a published household measure — "바나나 50 g (중 1/2개)" in the
 *              diabetes food-exchange lists. A real source, but one egg is
 *              not every egg, so the result is always marked estimated.
 *   typical    a documented typical size where no measure is published for
 *              this food itself — a café cup taken from MFDS's own café rows.
 *              Also always estimated.
 *
 * None of these produce a calorie figure. They turn a human unit into grams;
 * the energy still comes from the MFDS row.
 */
export type ServingBasis =
  | { kind: "mfds" }
  | {
      kind: "reference" | "typical";
      note: string;
      citation: string;
      /** The source measures a volume (a cup, a carton); read as grams at 1 g/mL. */
      measure?: "mL";
    };

/** A portion this food is normally counted in: 한 공기 = 210 g. */
export type Serving = {
  /** The counter, matching the units the quantity parser produces. */
  unit: string;
  grams: number;
  /** Omitted for a portion the MFDS row states itself. */
  basis?: ServingBasis;
};

/** True when a portion is a published or typical size rather than this row's own. */
export function isEstimatedServing(serving: Serving): boolean {
  return serving.basis !== undefined && serving.basis.kind !== "mfds";
}

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
  /**
   * Set when the food is clear but what goes into it is not: a 마라탕 is
   * whatever was put in the bowl, a 치킨 is however much of it was eaten.
   * The entry is still a real MFDS row and is recorded at its figure without
   * asking; this only makes the app say that the figure is a representative
   * one. Absent means the row can be taken as it stands.
   */
  variance?: "high";
  /**
   * Set on the one kind of a product its bare name stands for — 포카칩 is
   * recorded as 포카칩 오리지널. `brand` is the bare name, `label` the kind it
   * was taken as, and `example` another kind to show in the hint, so the
   * reply can say which was assumed and how to change it.
   */
  variant?: FoodVariant;
  /**
   * A brand's product (신라면, 포카칩): reached only by its own name or an
   * alias said in full, never by a word inside it — "새우" must not offer
   * 새우깡, nor "라면" 신라면.
   */
  brand?: true;
  /** Provenance, so a figure can always be traced back. */
  source: string;
};

export type FoodVariant = { brand: string; label: string; example: string };

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
  /**
   * Why the portion is an estimate, when it came from a reference rather than
   * the MFDS row: "1개 50g 기준 · 당뇨병 식품교환표". Carried onto the stored
   * item so the "~" in the list can say what it stands for.
   */
  portionNote?: string;
  /** How well the name matched, 0-1. */
  score: number;
};

/**
 * Why a food we recognise still cannot be counted.
 *
 *   missing_serving   the entry states no portion at any counter — MFDS
 *                     gives 닭가슴살 per 100 g and nothing per pack.
 *   unsupported_unit  the entry has portions, but not in the counter the
 *                     user said. "만두 5개" against a food published per
 *                     인분 used to be priced as five 인분; multiplying one
 *                     portion size by a count of a different unit is exactly
 *                     the silent wrong number this layer exists to prevent,
 *                     so it now asks instead.
 *   partly_left       the user said they left some of it in a way no
 *                     arithmetic settles — "비빔밥 먹었는데 밥은 반
 *                     남겼어" left half the *rice*, and nothing states how
 *                     much of a 비빔밥 its rice is. Neither the full bowl nor
 *                     half of it is the answer, so the amount is asked for.
 */
export type UnmeasurableReason = "missing_serving" | "unsupported_unit" | "partly_left";

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
      /**
       * Present when the candidates are different foods the phrase names
       * ("라면 끓여서 계란 두 개 넣고"), not readings of one word: each food as
       * its own phrase, for when the user answers "둘 다".
       */
      together?: ParsedFoodPhrase[];
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
      /** The counter the user said, for `unsupported_unit`. */
      unit?: string;
    }
  | { status: "unknown"; phrase: ParsedFoodPhrase }
  /**
   * Several foods said one after another with only a space between them —
   * "제육 김치". Each piece is its own phrase, to be resolved on its own; the
   * last carries the amount said at the end of the whole.
   */
  | { status: "listed"; phrase: ParsedFoodPhrase; pieces: ParsedFoodPhrase[] };

/**
 * The port. Phase 5 ships a local-dataset implementation; the MFDS OpenAPI
 * becomes a second one behind the same interface, and the LLM fallback sits
 * in front of it as a parser, never as a source of numbers.
 */
export interface NutritionResolver {
  resolve(phrase: ParsedFoodPhrase): Promise<PhraseResolution>;
}

export type { ParsedFoodPhrase };
