import { segmentFoods, toFoodPhrase } from "@/ai/nutrition/foodPhrases";
import {
  UNNAMED_FOOD_LABEL,
  cleanFoodLabel,
  findStatedCalories,
  statesATotal,
} from "@/ai/nutrition/statedCalories";
import type {
  NutritionMatch,
  NutritionResolver,
  ParsedFoodPhrase,
  PhraseResolution,
  UnmeasurableReason,
} from "@/ai/nutrition/types";
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
export type AddPart = AddPartBody & {
  /**
   * Cut from a phrase that listed foods with only a space between them
   * ("제육 김치"). Such a sentence is shown before it is stored: reading two
   * foods where one was meant must cost a "no", never a wrong record.
   */
  listed?: true;
};

type AddPartBody =
  | {
      status: "resolved";
      /** The phrase as the user said it, for the reply. */
      phraseName: string;
      item: NewFoodItem;
      /**
       * No amount was said and one serving was assumed. Not stored — the
       * reply says it once, so the user knows what the figure stands on.
       */
      amountAssumed?: true;
    }
  | {
      status: "ambiguous";
      phraseName: string;
      /**
       * Already priced for the amount the user gave, so choosing one is a
       * pick and not a recalculation.
       */
      candidates: AddCandidate[];
      /**
       * The amount as the user said it ("한 공기"), absent when none was said
       * and a serving was assumed — so answering "다른 음식이에요" never puts
       * an assumed 1인분 on a record of the user's own figure.
       */
      saidAmount?: string;
    }
  | {
      status: "unmeasurable";
      phraseName: string;
      /** What the dataset matched. Usually one. */
      entries: { id: string; name: string }[];
      reason: UnmeasurableReason;
      /** For `unsupported_unit`: the counter the user said ("개"). */
      unit?: string;
      /**
       * For `unsupported_unit`: the counters the first entry *does* publish
       * ("인분"), so the question can offer them as well as grams.
       */
      knownUnits?: string[];
    }
  | {
      status: "unknown";
      phraseName: string;
      /**
       * The amount the user already said, when the food turned out not to be
       * any the dataset offered ("다른 음식이에요" after "튀김 2개"). Kept on
       * the record their stated calories create, so nothing they said is lost.
       */
      amount?: string;
    }
  /**
   * An unknown food the user chose to leave out when asked for its calories.
   * Kept rather than dropped so the reply can still say what was left out.
   */
  | { status: "skipped"; phraseName: string };

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
    // A representative figure is an estimate even when the amount was said
    // outright: "마라탕 1인분" is still whatever went into that bowl.
    caloriesEstimated: match.estimated || match.entry.variance === "high",
    ...(match.portionNote === undefined ? {} : { portionNote: match.portionNote }),
    ...(match.entry.variance === "high" ? { calorieVariance: "high" as const } : {}),
  };
}

/**
 * A figure the user gave, as the domain stores it. The number is theirs and
 * is copied exactly; only the name is ours to choose.
 */
export function userStatedItem(label: string | null, calories: number): NewFoodItem {
  return {
    name: label ?? UNNAMED_FOOD_LABEL,
    calories,
    caloriesEstimated: false,
    calorieSource: "user",
  };
}

function userStatedPart(label: string | null, calories: number, amount?: string): AddPart {
  const stated = userStatedItem(label, calories);
  const item = amount === undefined ? stated : { ...stated, amount };
  return { status: "resolved", phraseName: item.name, item };
}

/**
 * The one case where a stated figure covers the whole sentence rather than
 * its own slice.
 *
 * "김치찌개랑 밥 합쳐서 800칼로리" states one number for two foods; pricing
 * 김치찌개 from the dataset as well would count it twice. The same holds when
 * the slice with the number names no food of its own — "밥이랑 반찬 해서 한
 * 700" is talk around a total, not a food called "해서". When every slice
 * reads as a name, the row is named after all of them.
 */
function wholeSentenceFigure(segments: string[]): AddPart | null {
  const stated = segments.map(findStatedCalories);
  const found = stated.filter((entry) => entry !== null);
  if (found.length !== 1) return null;

  const figure = found[0];
  if (figure === undefined) return null;

  const isTotal =
    segments.length === 1 ||
    figure.label === null ||
    segments.some(statesATotal);
  if (!isTotal) return null;

  const labels = segments.map((segment, index) =>
    stated[index] === null ? cleanFoodLabel(segment) : stated[index]?.label ?? null,
  );
  const named = labels.every((label) => label !== null);

  return userStatedPart(
    named ? labels.join(", ") : null,
    figure.calories,
    segments.length === 1 ? figure.amount : undefined,
  );
}

/**
 * Runs the whole sentence through the resolver.
 *
 * Every phrase gets an answer, including the ones that failed, because the
 * reply has to be able to name what it could not add. A slice that states its
 * own calories is not looked up at all: what the user said outranks what the
 * dataset knows about something like it.
 */
export async function resolveAddParts(
  sourceText: string,
  resolver: NutritionResolver,
): Promise<AddPart[]> {
  const segments = segmentFoods(sourceText);

  const whole = wholeSentenceFigure(segments.map((segment) => segment.text));
  if (whole !== null) return [whole];

  const resolved = await Promise.all(
    segments.map(async ({ text: segment, amountUnresolved }): Promise<Said[]> => {
      const explicit = toFoodPhrase(segment)?.quantity.assumed === false;

      const stated = findStatedCalories(segment);
      if (stated !== null) {
        return [{ part: userStatedPart(stated.label, stated.calories, stated.amount), explicit }];
      }

      const phrase = toFoodPhrase(segment);
      if (phrase === null) return [];

      const resolution = await resolver.resolve(phrase);
      if (resolution.status !== "listed") {
        return [{ part: partFor(phrase, resolution, amountUnresolved), explicit }];
      }

      return Promise.all(
        resolution.pieces.map(async (piece): Promise<Said> => {
          const own = await resolver.resolve(piece);
          // A piece is one food by construction; should it come back as a
          // list again, it is asked about under its own words, not guessed.
          const part =
            own.status === "listed"
              ? ({ status: "unknown", phraseName: piece.name } as const)
              : partFor(piece, own, amountUnresolved);
          return { part: { ...part, listed: true }, explicit: !piece.quantity.assumed };
        }),
      );
    }),
  );

  return lastSayWins(
    segments.flatMap((segment, index) =>
      (resolved[index] ?? []).map((said) => ({ ...said, clause: segment.clause })),
    ),
  );
}

/** A part, and whether the user said its amount rather than leaving it assumed. */
type Said = { part: AddPart; explicit: boolean };

/** What one resolved phrase becomes on the wire. */
function partFor(
  phrase: ParsedFoodPhrase,
  resolution: Exclude<PhraseResolution, { status: "listed" }>,
  amountUnresolved: true | undefined,
): AddPart {
  // Part of it was left in a way no arithmetic settles. The food is
  // still worth naming — the dataset knows it — but its amount is not
  // the one said, so it is asked for rather than priced. An unknown
  // food needs its calories asked for anyway, which covers this too.
  if (amountUnresolved === true && resolution.status !== "unknown") {
    const entries =
      resolution.status === "resolved"
        ? [resolution.match.entry]
        : resolution.status === "ambiguous"
          ? resolution.candidates.map((match) => match.entry)
          : resolution.entries;
    const knownUnits = (entries[0]?.servings ?? []).map((serving) => serving.unit);
    return {
      status: "unmeasurable",
      phraseName: phrase.name,
      entries: entries.map((entry) => ({ id: entry.id, name: entry.name })),
      reason: "partly_left",
      ...(knownUnits.length === 0 ? {} : { knownUnits }),
    };
  }

  switch (resolution.status) {
    case "resolved":
      return {
        status: "resolved",
        phraseName: phrase.name,
        item: toFoodItem(resolution.match),
        ...(phrase.quantity.assumed ? { amountAssumed: true as const } : {}),
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
        ...(phrase.quantity.assumed ? {} : { saidAmount: phrase.quantity.text }),
      };

    case "unmeasurable": {
      const knownUnits = (resolution.entries[0]?.servings ?? []).map(
        (serving) => serving.unit,
      );
      return {
        status: "unmeasurable",
        phraseName: phrase.name,
        entries: resolution.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
        })),
        reason: resolution.reason,
        ...(resolution.unit === undefined ? {} : { unit: resolution.unit }),
        ...(knownUnits.length === 0 ? {} : { knownUnits }),
      };
    }

    case "unknown":
      // The amount said ("구운 계란 두 개") stays with the food, so the record
      // made from the user's own figure still says how much it was.
      return {
        status: "unknown",
        phraseName: phrase.name,
        ...(phrase.quantity.assumed ? {} : { amount: phrase.quantity.text }),
      };
  }
}

/**
 * One food, one record — when the sentence settles it twice.
 *
 * "떡볶이랑 튀김 먹었는데 떡볶이는 반만 먹었어" names 떡볶이 once with no
 * amount and again, in a later clause, with 반. Nothing is stored yet, so
 * this is not a modify: the later, explicit amount is simply what was meant,
 * and it replaces the earlier part where it stood. Two parts in the same
 * clause are two helpings and are left alone.
 */
function lastSayWins(
  parts: { part: AddPart; clause: number; explicit: boolean }[],
): AddPart[] {
  const kept: { part: AddPart; clause: number }[] = [];
  for (const { part, clause, explicit } of parts) {
    if (part.status === "resolved" && explicit && part.item.calorieSource !== "user") {
      const earlier = kept.findIndex(
        (other) =>
          other.clause < clause &&
          other.part.status === "resolved" &&
          other.part.item.name === part.item.name,
      );
      if (earlier !== -1) {
        kept[earlier] = { part, clause };
        continue;
      }
    }
    kept.push({ part, clause });
  }
  return kept.map((entry) => entry.part);
}

/**
 * True when nothing is left to ask and the record can be written.
 *
 * An unknown food is not settled: the user may know its calories, and asking
 * costs one short reply where skipping it silently undercounts the day.
 */
export function isSettled(parts: AddPart[]): boolean {
  return parts.every(
    (part) => part.status === "resolved" || part.status === "skipped",
  );
}

/** Nothing in the sentence is anything but a food the dataset does not have. */
export function isAllUnknown(parts: AddPart[]): boolean {
  return parts.length > 0 && parts.every(
    (part) => part.status === "unknown" || part.status === "skipped",
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
 * True when a correction names the entry's own food but could not be read.
 *
 * A correction whose amount the quantity parser cannot read keeps that
 * wording inside the name ("갈비탕 … 먹었어" with an amount it does not
 * know). The matcher refuses a food that is not the last thing in its
 * phrase, so the part comes back `unknown`; asking for its calories would be
 * the wrong question about a food already logged. The amount is what the
 * user was correcting, so that is what to ask for.
 *
 * Not for "갈비탕 아니고 마라탕", which also comes back as one unknown phrase
 * containing 갈비탕: that names a replacement, and 마라탕 is a real question.
 */
export function isUnreadCorrectionOf(
  parts: AddPart[],
  targetFoodName: string,
  namesASubstitution = false,
): boolean {
  if (namesASubstitution) return false;
  const target = targetFoodName.replace(/\s+/g, "");
  return (
    parts.length > 0 &&
    parts.every(
      (part) =>
        part.status === "unknown" && part.phraseName.replace(/\s+/g, "").includes(target),
    )
  );
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
