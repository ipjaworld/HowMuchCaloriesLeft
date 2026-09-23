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

/** A weight or volume, which every food can be measured in. */
function isMetricUnit(unit: string): boolean {
  return (
    GRAM_UNITS.has(unit) ||
    KILOGRAM_UNITS.has(unit) ||
    MILLILITRE_UNITS.has(unit) ||
    LITRE_UNITS.has(unit)
  );
}

type Weighed = {
  grams: number;
  estimated: boolean;
  /** The counter the portion was read in, or null for a raw weight. */
  unit: string | null;
} | null;

/**
 * Turns "두 공기" into grams using the entry's own portion table. Returns
 * null when the food has no portion we can scale, which is a real answer:
 * the app asks rather than inventing one.
 *
 * A bare food name lands in the last branch, and that is the case this
 * function exists for. "계란" carries no amount, so it is counted as one of
 * whatever the entry's first portion is — one 개 for an egg, one 그릇 for a
 * soup. The counter comes from the dataset, so it is a lookup, not a guess.
 */
export function toGrams(quantity: Quantity, entry: FoodEntry): Weighed {
  const { value, unit } = quantity;

  if (unit !== null) {
    if (GRAM_UNITS.has(unit)) return { grams: value, estimated: false, unit };
    if (KILOGRAM_UNITS.has(unit)) {
      return { grams: value * 1000, estimated: false, unit };
    }
    if (MILLILITRE_UNITS.has(unit)) {
      return { grams: value, estimated: true, unit };
    }
    if (LITRE_UNITS.has(unit)) {
      return { grams: value * 1000, estimated: true, unit };
    }

    const serving = entry.servings?.find((candidate) => candidate.unit === unit);
    if (serving !== undefined) {
      return { grams: value * serving.grams, estimated: quantity.assumed, unit };
    }
  }

  // A count with no counter ("계란", "삼각김밥 하나"), or a counter this food
  // has no figure for — use its natural portion and report which one.
  const fallback = entry.servings?.[0];
  if (fallback === undefined) return null;

  return {
    grams: value * fallback.grams,
    // An unfamiliar counter was silently swapped for the default one, so that
    // is an approximation even when the user did give an amount.
    estimated: quantity.assumed || unit !== null,
    unit: fallback.unit,
  };
}

/** How the amount reads back to the user once it has been resolved. */
function describeAmount(
  quantity: Quantity,
  weighed: NonNullable<Weighed>,
): NutritionMatch["amount"] {
  // The user said it themselves — keep their wording.
  if (!quantity.assumed && quantity.text.length > 0) {
    return { value: quantity.value, unit: quantity.unit, text: quantity.text };
  }

  return {
    value: quantity.value,
    unit: weighed.unit,
    text:
      weighed.unit === null
        ? `${quantity.value}`
        : `${quantity.value}${weighed.unit}`,
  };
}

/** Rounded to whole calories: a tenth of a kcal is noise, not information. */
export function caloriesFor(
  quantity: Quantity,
  entry: FoodEntry,
): NutritionMatch | null {
  const weighed = toGrams(quantity, entry);
  if (weighed === null) return null;

  return {
    entry,
    calories: Math.round((entry.caloriesPer100g * weighed.grams) / 100),
    amount: describeAmount(quantity, weighed),
    estimated: weighed.estimated,
    score: 0,
  };
}

/**
 * Narrows name matches by the counter the user actually used.
 *
 * "밥" is inside 쌀밥, 현미밥, 김밥 and 비빔밥, so the name alone scores all
 * four identically and the app asks which of the four was meant — including
 * two nobody counts in 공기. The counter settles it: 쌀밥 and 현미밥 publish
 * a 공기 portion, 김밥 publishes 줄 and 비빔밥 그릇, so "한 공기" can only
 * mean the first two. What remains is the real ambiguity, worth asking about.
 *
 * This is a constraint read out of the data, not a guess about language: it
 * only ever consults `servings`, which came from MFDS. Three rules keep it
 * from throwing away real answers:
 *
 *   - an assumed amount narrows nothing, since the user named no counter;
 *   - grams and millilitres narrow nothing, because they apply to every food;
 *   - if the counter matches no candidate at all, every candidate is kept —
 *     an unfamiliar counter is handled downstream by falling back to the
 *     natural portion, and that is better than answering "I know nothing".
 */
export function narrowByServingUnit(
  entries: FoodEntry[],
  quantity: Quantity,
): FoodEntry[] {
  const { unit } = quantity;
  if (unit === null || quantity.assumed) return entries;
  if (isMetricUnit(unit)) return entries;

  const publishing = entries.filter((entry) =>
    entry.servings?.some((serving) => serving.unit === unit),
  );

  return publishing.length > 0 ? publishing : entries;
}

export function createLocalDatasetResolver(
  entries: FoodEntry[],
): NutritionResolver {
  return {
    async resolve(phrase: ParsedFoodPhrase): Promise<PhraseResolution> {
      const found = findByName(entries, phrase.name);

      // Not in the dataset. Nothing the user can say will price it.
      if (found.kind === "none") return { status: "unknown", phrase };

      const matched =
        found.kind === "one"
          ? [found.entry]
          : narrowByServingUnit(found.entries, phrase.quantity);

      const candidates = matched
        .map((entry) => caloriesFor(phrase.quantity, entry))
        .filter((match): match is NutritionMatch => match !== null)
        .map((match) => ({ ...match, score: found.score }));

      // Known foods, but the data states no weight for any of them. Distinct
      // from `unknown`: naming an amount in grams or millilitres resolves it,
      // and the reply can say so.
      if (candidates.length === 0) {
        return {
          status: "unmeasurable",
          phrase,
          entries: matched,
          reason: "missing_serving",
        };
      }

      if (candidates.length === 1 && candidates[0] !== undefined) {
        return { status: "resolved", phrase, match: candidates[0] };
      }

      return { status: "ambiguous", phrase, candidates };
    },
  };
}
