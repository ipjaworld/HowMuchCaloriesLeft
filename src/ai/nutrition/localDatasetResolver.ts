import { toFoodPhrase, type ParsedFoodPhrase } from "./foodPhrases";
import { assumedQuantity, type Quantity } from "./quantity";
import { findByName, mentionPieces, splitListedFoods } from "./dataset";
import {
  isEstimatedServing,
  type FoodEntry,
  type NutritionMatch,
  type NutritionResolver,
  type PhraseResolution,
  type Serving,
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
  /** The portion used, when a counter was converted through one. */
  serving?: Serving;
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
      return {
        grams: value * serving.grams,
        // A published egg weight is still not *this* egg's weight.
        estimated: quantity.assumed || isEstimatedServing(serving),
        unit,
        serving,
      };
    }
  }

  // A counter this food has no figure for. This used to fall back to the
  // natural portion, which turned "만두 5개" into five 인분 — a portion size
  // multiplied by a count of something else. Refusing is the honest answer;
  // the caller asks, and "g" or a counter the food does have settles it.
  if (unit !== null) return null;

  // A count with no counter ("계란", "삼각김밥 하나") — use the food's
  // natural portion and report which one.
  const fallback = entry.servings?.[0];
  if (fallback === undefined) return null;

  return {
    grams: value * fallback.grams,
    // "하나" of a food counted in 그릇 is one 그릇; only an assumed amount,
    // or a portion that is itself a reference size, makes it approximate.
    estimated: quantity.assumed || isEstimatedServing(fallback),
    unit: fallback.unit,
    serving: fallback,
  };
}

/**
 * "1개 50g 기준 (계란후라이 1개 (계란 50 g)) · 출처" — the conversion, the
 * measure as the source printed it, and the source, for a portion that did
 * not come from the MFDS row. A volume is shown as the volume it is ("1팩
 * 200mL"), not as the grams it is read as.
 */
function portionNoteFor(serving: Serving | undefined): string | undefined {
  const basis = serving?.basis;
  if (serving === undefined || basis === undefined || basis.kind === "mfds") {
    return undefined;
  }
  const measure = basis.measure ?? "g";
  return `1${serving.unit} ${serving.grams}${measure} 기준 (${basis.note}) · ${basis.citation}`;
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
  const portionNote = portionNoteFor(weighed.serving);

  return {
    entry,
    calories: Math.round((entry.caloriesPer100g * weighed.grams) / 100),
    amount: describeAmount(quantity, weighed),
    estimated: weighed.estimated,
    ...(portionNote === undefined ? {} : { portionNote }),
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
 *     each then comes back `unsupported_unit`, which still says "we know
 *     this food", rather than `unknown`, which would say we do not.
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

      // "제육 김치": two foods, not two readings of one. Each is resolved on
      // its own, and the amount said at the end stays with the last.
      if (found.kind === "several") {
        const listed = splitListedFoods(entries, phrase.name);
        if (listed !== null) {
          const pieces = listed.map((piece, index) =>
            index === listed.length - 1
              ? { name: piece, quantity: phrase.quantity, sourceText: phrase.sourceText }
              : (toFoodPhrase(piece) ?? { name: piece, quantity: assumedQuantity(), sourceText: piece }),
          );
          return { status: "listed", phrase, pieces };
        }
      }

      // "큰 계란 두 개": the food is known, but the published weight of one
      // is not a large one's, and no rule scales it. Grams settle it; a count
      // cannot, so the amount is asked rather than the standard size stored.
      if (found.sizeQualified === true && (phrase.quantity.unit === null || !isMetricUnit(phrase.quantity.unit))) {
        const entries = found.kind === "one" ? [found.entry] : found.entries;
        return { status: "unmeasurable", phrase, entries, reason: "missing_serving" };
      }

      const matched =
        found.kind === "one"
          ? [found.entry]
          : narrowByServingUnit(found.entries, phrase.quantity);

      const candidates = matched
        .map((entry) => caloriesFor(phrase.quantity, entry))
        .filter((match): match is NutritionMatch => match !== null)
        .map((match) => ({ ...match, score: found.score }));

      // "음료" reaches seven drinks and only 이온음료 states a glass; two
      // foods the list above could not cut apart ("라면 끓여서 계란 넣고")
      // may have only one with a portion. One food
      // left standing because the others have no published portion is the
      // dataset choosing, not the user — and for two foods in one phrase it
      // would drop the other without a word. So it is treated exactly as if
      // none could be priced: every food the phrase reached is kept, and the
      // app asks how much. A counter the user actually said is different
      // evidence, and has already narrowed `matched` itself above.
      const onlyOnePriceable = matched.length > 1 && candidates.length === 1;
      const genericLeftover = found.kind === "several" && found.generic === true;

      // Known foods, but no weight for the amount as said. Distinct from
      // `unknown`: naming grams — or a counter the food does publish —
      // resolves it, and the reply can say so.
      if (candidates.length === 0 || (onlyOnePriceable && !genericLeftover)) {
        const unit = phrase.quantity.unit;
        const hasPortions = matched.some(
          (entry) => (entry.servings?.length ?? 0) > 0,
        );
        return unit !== null && hasPortions
          ? { status: "unmeasurable", phrase, entries: matched, reason: "unsupported_unit", unit }
          : { status: "unmeasurable", phrase, entries: matched, reason: "missing_serving" };
      }

      if (candidates.length === 1 && candidates[0] !== undefined) {
        // "빵 2조각" reaches 식빵 only because 식빵 is the one bread that
        // publishes a 조각, and "회" reaches 육회 only because 연어회 states
        // no portion: a word that names a whole kind of food, narrowed to
        // one of them by what the dataset happens to carry. A lone generic
        // match is no match (see `findByName`), and one left standing
        // after the others fell away is the same thing — so it is unknown,
        // and the app asks, rather than recording the pick the data made.
        if (found.kind === "several" && found.generic === true) {
          return { status: "unknown", phrase };
        }
        return { status: "resolved", phrase, match: candidates[0] };
      }

      // Different foods in one phrase, not kinds of one: the user may say
      // "둘 다", so each is kept ready as its own phrase. An amount at the
      // very end belongs to the last.
      const pieces = found.kind === "several" ? mentionPieces(entries, phrase.name) : null;
      if (pieces !== null) {
        const together = pieces.map((piece, index) => {
          const own = toFoodPhrase(piece) ?? { name: piece, quantity: assumedQuantity(), sourceText: piece };
          return index === pieces.length - 1 && own.quantity.assumed
            ? { ...own, quantity: phrase.quantity }
            : own;
        });
        return { status: "ambiguous", phrase, candidates, together };
      }

      return { status: "ambiguous", phrase, candidates };
    },
  };
}
