import { parseFoodPhrases } from "@/ai/nutrition/foodPhrases";
import type { NutritionMatch, NutritionResolver } from "@/ai/nutrition/types";
import type { NewFoodItem } from "./mealRecords";

/**
 * Turning "갈비탕 하나랑 밥 한 공기 먹었어" into something the browser can
 * store.
 *
 * The server does the looking up and the browser does the storing, so what
 * crosses between them is this: one typed part per food phrase, saying either
 * what it costs or exactly what is still missing. Never prose — the client
 * must not have to read a sentence to decide what to do.
 *
 * Resolution is *not* driven by Jev's clarification probability. The Phase 4.5
 * measurement found that noul's two distributions overlap almost end to end in
 * Korean, while the question it is being asked here — which food, and how
 * much — is one the resolver answers from data with certainty. Where code
 * knows, code decides.
 */

/** One food phrase, with whatever the dataset could say about it. */
export type AddPart =
  | {
      status: "resolved";
      /** The phrase as the user said it, for the reply. */
      phraseName: string;
      item: NewFoodItem;
    }
  | {
      status: "ambiguous";
      phraseName: string;
      /**
       * Already priced for the amount the user gave, so choosing one is a
       * pick and not a recalculation.
       */
      candidates: AddCandidate[];
    }
  | {
      status: "unmeasurable";
      phraseName: string;
      /** What the dataset matched. Usually one. */
      entries: { id: string; name: string }[];
      reason: "missing_serving";
    }
  | { status: "unknown"; phraseName: string };

export type AddCandidate = {
  /** The dataset entry id, which is the MFDS food code. */
  entryId: string;
  name: string;
  item: NewFoodItem;
};

/** A `NutritionMatch` as the domain stores it. The calories are copied, never recomputed. */
export function toFoodItem(match: NutritionMatch): NewFoodItem {
  return {
    // The dataset's canonical name, not the user's wording: "공기밥" is stored
    // as 쌀밥 so the list reads consistently. What the user actually typed is
    // kept on the record's `sourceText`.
    name: match.entry.name,
    amount: match.amount.text,
    calories: match.calories,
    caloriesEstimated: match.estimated,
  };
}

/**
 * Runs the whole sentence through the resolver.
 *
 * Every phrase gets an answer, including the ones that failed, because the
 * reply has to be able to name what it could not add.
 */
export async function resolveAddParts(
  sourceText: string,
  resolver: NutritionResolver,
): Promise<AddPart[]> {
  const phrases = parseFoodPhrases(sourceText);

  return Promise.all(
    phrases.map(async (phrase): Promise<AddPart> => {
      const resolution = await resolver.resolve(phrase);

      switch (resolution.status) {
        case "resolved":
          return {
            status: "resolved",
            phraseName: phrase.name,
            item: toFoodItem(resolution.match),
          };

        case "ambiguous":
          return {
            status: "ambiguous",
            phraseName: phrase.name,
            candidates: resolution.candidates.map((match) => ({
              entryId: match.entry.id,
              name: match.entry.name,
              item: toFoodItem(match),
            })),
          };

        case "unmeasurable":
          return {
            status: "unmeasurable",
            phraseName: phrase.name,
            entries: resolution.entries.map((entry) => ({
              id: entry.id,
              name: entry.name,
            })),
            reason: resolution.reason,
          };

        case "unknown":
          return { status: "unknown", phraseName: phrase.name };
      }
    }),
  );
}

/** True when nothing is left to ask and the record can be written. */
export function isSettled(parts: AddPart[]): boolean {
  return parts.every(
    (part) => part.status === "resolved" || part.status === "unknown",
  );
}

/** The items a settled set of parts would store. */
export function itemsOf(parts: AddPart[]): NewFoodItem[] {
  return parts.flatMap((part) => (part.status === "resolved" ? [part.item] : []));
}

/**
 * Collapses an ambiguity the target already answers.
 *
 * "아까 밥 반만 먹었어" parses as the food "밥" with the amount 0.5, and "밥"
 * matches four foods — but the entry being corrected is already known to be
 * 쌀밥, so there is nothing to ask. Only a candidate the correction could
 * actually be about is used; if none of them is the target's food, the
 * ambiguity is real and stays.
 *
 * This is the whole of what a modify needed on top of the add pipeline. The
 * parsing, the resolving and the asking are all the Phase 6A ones.
 */
export function preferTargetFood(
  parts: AddPart[],
  targetFoodName: string,
  namesASubstitution = false,
): AddPart[] {
  return parts.map((part) => {
    if (part.status !== "ambiguous") return part;

    const onTarget = part.candidates.find(
      (candidate) => candidate.name === targetFoodName,
    );
    if (onTarget === undefined) return part;

    // "갈비탕 아니고 김치찌개" names a replacement, so collapsing onto the
    // target would answer the wrong question — it would re-price the food the
    // user just said it was not. Leave the choice open and let them settle it.
    if (namesASubstitution && part.candidates.length > 1) return part;

    return { status: "resolved", phraseName: part.phraseName, item: onTarget.item };
  });
}

/**
 * Whether the sentence explicitly replaces one food with another.
 *
 * Three fixed markers rather than grammar: 말고 / 아니고 / 아니라 are how a
 * correction is actually said, and a fixed list cannot misread a sentence the
 * way a parser can. It decides only whether to *ask*, never what to store.
 */
export function namesASubstitution(message: string): boolean {
  return /(말고|아니고|아니라)/.test(message);
}

/**
 * True when re-pricing produced what is already stored.
 *
 * "갈비탕 반 그릇만 먹었어" is a correction the phrase parser cannot read —
 * it keeps the whole thing as a name and assumes one serving, which lands
 * back on the figure already there. Saying "고쳤어요" then would be a lie, so
 * the caller asks for the amount instead.
 */
export function isSameAs(
  item: NewFoodItem,
  current: { name: string; calories: number },
): boolean {
  return item.name === current.name && item.calories === current.calories;
}
