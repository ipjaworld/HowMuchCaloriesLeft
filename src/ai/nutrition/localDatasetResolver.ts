import type { ParsedFoodPhrase } from "./foodPhrases";
import type { Quantity } from "./quantity";
import { findByName } from "./dataset";
import type {
  FoodEntry,
  NutritionMatch,
  NutritionResolver,
  PhraseResolution,
} from "./types";

/**
 * Resolves a food phrase against the bundled dataset.
 *
 * Every number it returns comes out of the dataset and is scaled by ordinary
 * arithmetic. Nothing here estimates a calorie figure — when the portion is
 * a guess, the result says so, and when the food is unknown, it says that
 * instead of producing a plausible number.
 */

/** Metric units that need no portion table. */
const GRAM_UNITS = new Set(["g", "그램"]);
const KILOGRAM_UNITS = new Set(["kg", "킬로"]);
/** Millilitres are read as grams. Fine for drinks, a guess for anything else. */
const MILLILITRE_UNITS = new Set(["ml", "mL"]);
const LITRE_UNITS = new Set(["리터"]);

type Weighed = { grams: number; estimated: boolean } | null;

/**
 * Turns "두 공기" into grams using the entry's own portion table. Returns
 * null when the food has no portion we can scale, which is a real answer:
 * the app asks rather than inventing one.
 */
export function toGrams(quantity: Quantity, entry: FoodEntry): Weighed {
  const { value, unit } = quantity;

  if (unit !== null) {
    if (GRAM_UNITS.has(unit)) return { grams: value, estimated: false };
    if (KILOGRAM_UNITS.has(unit)) return { grams: value * 1000, estimated: false };
    if (MILLILITRE_UNITS.has(unit)) return { grams: value, estimated: true };
    if (LITRE_UNITS.has(unit)) return { grams: value * 1000, estimated: true };

    const serving = entry.servings?.find((candidate) => candidate.unit === unit);
    if (serving !== undefined) {
      return { grams: value * serving.grams, estimated: quantity.assumed };
    }
  }

  // A count with no counter ("삼각김밥 하나"), or a counter this food does
  // not have a figure for — fall back to its default portion and say so.
  const fallback = entry.servings?.[0];
  if (fallback === undefined) return null;

  return {
    grams: value * fallback.grams,
    estimated: quantity.assumed || unit !== null,
  };
}

/** Rounded to whole calories: a tenth of a kcal is noise, not information. */
export function caloriesFor(quantity: Quantity, entry: FoodEntry): NutritionMatch | null {
  const weighed = toGrams(quantity, entry);
  if (weighed === null) return null;

  return {
    entry,
    calories: Math.round((entry.caloriesPer100g * weighed.grams) / 100),
    estimated: weighed.estimated,
    score: 0,
  };
}

export function createLocalDatasetResolver(
  entries: FoodEntry[],
): NutritionResolver {
  return {
    async resolve(phrase: ParsedFoodPhrase): Promise<PhraseResolution> {
      const found = findByName(entries, phrase.name);

      if (found.kind === "none") return { status: "unknown", phrase };

      if (found.kind === "one") {
        const match = caloriesFor(phrase.quantity, found.entry);
        // A known food we cannot weigh is still unknown for our purposes.
        if (match === null) return { status: "unknown", phrase };
        return { status: "resolved", phrase, match: { ...match, score: found.score } };
      }

      const candidates = found.entries
        .map((entry) => caloriesFor(phrase.quantity, entry))
        .filter((match): match is NutritionMatch => match !== null)
        .map((match) => ({ ...match, score: found.score }));

      if (candidates.length === 0) return { status: "unknown", phrase };
      if (candidates.length === 1 && candidates[0] !== undefined) {
        return { status: "resolved", phrase, match: candidates[0] };
      }

      return { status: "ambiguous", phrase, candidates };
    },
  };
}
