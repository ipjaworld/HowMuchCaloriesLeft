import type { UnmeasurableReason } from "@/ai/nutrition/types";
import { cleanFoodLabel } from "@/ai/nutrition/statedCalories";
import { userStatedItem, type AddPart } from "./addFood";
import type { NewFoodItem } from "./mealRecords";

/**
 * The conversation state for one unfinished "I ate ..." sentence.
 *
 * This is what Phase 6A is really about. Resolving a single sentence is the
 * easy half; the hard half is that the resolver can come back needing
 * something only the user has — which of two rices, how big a cup — and the
 * *next* thing they type has to be read as an answer to that, not as a new
 * request.
 *
 * Two decisions worth keeping:
 *
 *   - **The parts are the state.** There is no separate queue of questions
 *     alongside them; `nextQuestion` derives what to ask from the parts that
 *     are still open. Two structures that must agree would eventually not.
 *   - **One sentence is one record.** A message naming two foods does not
 *     write the one it understood and then ask about the other. Everything
 *     waits, and a single `MealRecord` is written once nothing is open, so
 *     cancelling leaves nothing behind to undo.
 *
 * It is deliberately short-lived client state: not a server session, not
 * localStorage. A half-finished question is not data, and losing it on
 * refresh costs the user one retyped sentence.
 */

export type PendingAdd = {
  /** The original sentence, stored verbatim on the record. */
  sourceText: string;
  /** The browser's clock when it was sent; the server has no usable one. */
  now: string;
  /** Every phrase, resolved and unresolved alike, updated as answers arrive. */
  parts: AddPart[];
  /** Waiting on a plain yes before anything is stored. */
  needsConfirmation: boolean;
  /**
   * Set when this sentence corrects an entry instead of adding one. The same
   * questions and the same answers apply either way — only what happens at
   * the end differs, so there is no second pending structure for modify.
   */
  target?: {
    itemId: string;
    foodName: string;
    /** How the entry is shown in the confirmation, so the user sees which one. */
    amount?: string;
    consumedAt?: string;
    /**
     * How many leading parts are the correction. The parts after them are
     * other foods the same sentence reported, added as new entries — see
     * `mixedModify.ts`. Absent means every part is the correction.
     */
    modifyParts?: number;
  };
};

/** Whether the part at `partIndex` corrects the target rather than adding beside it. */
export function isModifyPart(pending: PendingAdd, partIndex: number): boolean {
  if (pending.target === undefined) return false;
  const count = pending.target.modifyParts ?? pending.parts.length;
  return partIndex < count;
}

export type PendingQuestion =
  | {
      /**
       * Asked when the judge was only moderately sure this was a food report
       * at all. It comes first, because there is no point choosing between
       * two rices for a sentence that will not be stored.
       */
      type: "confirm_add";
      names: string[];
      /** Correcting reads differently from adding, and must say so. */
      mode: "add" | "modify";
      /**
       * For a modify: foods that will be added beside the correction. Named
       * in the question, so the user sees every food the sentence touches.
       */
      addNames?: string[];
      /**
       * For a modify: the exact entry that will change and what it becomes.
       * The entry is the one `target.itemId` names — the one a "yes" writes
       * to — so the question cannot show one entry and change another.
       */
      change?: {
        target: { name: string; amount?: string; consumedAt?: string };
        replacement: { name: string; amount?: string; calories: number } | null;
      };
    }
  | {
      type: "choose_food";
      partIndex: number;
      phraseName: string;
      candidates: { entryId: string; name: string }[];
      /** Choosing what to add reads differently from choosing a replacement. */
      mode: "add" | "modify";
    }
  | {
      type: "provide_quantity";
      partIndex: number;
      phraseName: string;
      entries: { id: string; name: string }[];
      reason: UnmeasurableReason;
      unit?: string;
      knownUnits?: string[];
    }
  | {
      /**
       * The dataset has nothing for this food, but the user may know its
       * calories — a packet, a menu board, a guess. Their figure is stored as
       * said; the app still never supplies one of its own.
       */
      type: "provide_calories";
      partIndex: number;
      /**
       * The food's name when the phrase reads as one, null when it is a
       * scrap of sentence that should not be quoted back at the user.
       */
      label: string | null;
      /** Whether leaving it out would still leave something to record. */
      othersResolved: boolean;
    };

/**
 * How many foods a question may offer before the chips stop being a choice
 * and start being a list. Serving-aware narrowing already cuts most of this
 * down — "밥 한 공기" comes back as two — so this is a backstop.
 */
export const MAX_CHOICES = 5;

/** The first thing still standing between this sentence and a record. */
export function nextQuestion(pending: PendingAdd): PendingQuestion | null {
  if (pending.needsConfirmation) {
    const named = pending.parts
      .map((part, partIndex) => ({ part, partIndex }))
      .filter(({ part }) => part.status !== "skipped");
    const names = named
      .filter(
        ({ part, partIndex }) =>
          part.status !== "unknown" &&
          (pending.target === undefined || isModifyPart(pending, partIndex)),
      )
      .map(({ part }) => part.phraseName);
    // An addition is named even when unknown: 튀김 has no dataset entry, and
    // a question that left it out would hide that it is about to be asked.
    const addNames =
      pending.target === undefined
        ? []
        : named
            .filter(({ partIndex }) => !isModifyPart(pending, partIndex))
            .map(({ part }) => part.phraseName);
    const target = pending.target;
    const replacement =
      target === undefined
        ? undefined
        : pending.parts.find(
            (part, partIndex) => isModifyPart(pending, partIndex) && part.status === "resolved",
          );
    return {
      type: "confirm_add",
      mode: target === undefined ? "add" : "modify",
      names,
      ...(addNames.length === 0 ? {} : { addNames }),
      ...(target === undefined
        ? {}
        : {
            change: {
              target: {
                name: target.foodName,
                ...(target.amount === undefined ? {} : { amount: target.amount }),
                ...(target.consumedAt === undefined ? {} : { consumedAt: target.consumedAt }),
              },
              replacement:
                replacement?.status === "resolved"
                  ? {
                      name: replacement.item.name,
                      ...(replacement.item.amount === undefined ? {} : { amount: replacement.item.amount }),
                      calories: replacement.item.calories,
                    }
                  : null,
            },
          }),
    };
  }

  for (const [partIndex, part] of pending.parts.entries()) {
    if (part.status === "ambiguous") {
      return {
        type: "choose_food",
        partIndex,
        mode: isModifyPart(pending, partIndex) ? "modify" : "add",
        phraseName: part.phraseName,
        candidates: part.candidates
          .slice(0, MAX_CHOICES)
          .map(({ entryId, name }) => ({ entryId, name })),
      };
    }
    if (part.status === "unmeasurable") {
      return {
        type: "provide_quantity",
        partIndex,
        phraseName: part.phraseName,
        entries: part.entries,
        reason: part.reason,
        ...(part.unit === undefined ? {} : { unit: part.unit }),
        ...(part.knownUnits === undefined ? {} : { knownUnits: part.knownUnits }),
      };
    }
    if (part.status === "unknown") {
      return {
        type: "provide_calories",
        partIndex,
        label: cleanFoodLabel(part.phraseName),
        othersResolved: pending.parts.some(
          (other, index) => index !== partIndex && other.status === "resolved",
        ),
      };
    }
  }
  return null;
}

/** Nothing left to ask: the record can be written. */
export function isComplete(pending: PendingAdd): boolean {
  return nextQuestion(pending) === null;
}

/** The user said yes. Everything else about the sentence is unchanged. */
export function confirmAdd(pending: PendingAdd): PendingAdd {
  return { ...pending, needsConfirmation: false };
}

function replacePart(
  pending: PendingAdd,
  partIndex: number,
  part: AddPart,
): PendingAdd {
  const parts = pending.parts.slice();
  parts[partIndex] = part;
  return { ...pending, parts };
}

/**
 * The user picked one of the candidate foods. Its calories were computed for
 * the amount they originally gave, so this is a selection, not a new sum.
 */
export function answerChoice(
  pending: PendingAdd,
  partIndex: number,
  entryId: string,
): PendingAdd {
  const part = pending.parts[partIndex];
  if (part === undefined || part.status !== "ambiguous") return pending;

  const chosen = part.candidates.find(
    (candidate) => candidate.entryId === entryId,
  );
  if (chosen === undefined) return pending;

  return replacePart(pending, partIndex, {
    status: "resolved",
    phraseName: part.phraseName,
    item: chosen.item,
  });
}

/**
 * "다른 음식이에요": none of the offered foods is the one eaten.
 *
 * The part becomes a food the dataset does not have, which is a question the
 * app already asks — "대략 몇 kcal였나요?" — and the user's figure is stored
 * as said. No other part moves, so a sentence of three foods still becomes
 * one record of three, and the amount already said stays on the record.
 * Choosing which entry a *correction* is about is a different question, with
 * its own "해당 없음" (see `decideCommand`): this one only ever picks a food.
 */
export function answerNoneOfChoices(pending: PendingAdd, partIndex: number): PendingAdd {
  const part = pending.parts[partIndex];
  if (part === undefined || part.status !== "ambiguous") return pending;

  const amounts = new Set(part.candidates.map((candidate) => candidate.item.amount));
  const [amount] = amounts;
  return replacePart(pending, partIndex, {
    status: "unknown",
    phraseName: part.phraseName,
    ...(amounts.size === 1 && amount !== undefined ? { amount } : {}),
  });
}

/** The user supplied a weight, and the server priced it. */
export function answerQuantity(
  pending: PendingAdd,
  partIndex: number,
  item: NewFoodItem,
): PendingAdd {
  const part = pending.parts[partIndex];
  if (part === undefined || part.status !== "unmeasurable") return pending;

  return replacePart(pending, partIndex, {
    status: "resolved",
    phraseName: part.phraseName,
    item,
  });
}

/** The user gave the calories of a food the dataset does not have. */
export function answerCalories(
  pending: PendingAdd,
  partIndex: number,
  calories: number,
): PendingAdd {
  const part = pending.parts[partIndex];
  if (part === undefined || part.status !== "unknown") return pending;

  const stated = userStatedItem(cleanFoodLabel(part.phraseName), calories);
  const item = part.amount === undefined ? stated : { ...stated, amount: part.amount };
  return replacePart(pending, partIndex, {
    status: "resolved",
    phraseName: item.name,
    item,
  });
}

/** The user does not know the calories either; record the rest without it. */
export function skipUnknown(pending: PendingAdd, partIndex: number): PendingAdd {
  const part = pending.parts[partIndex];
  if (part === undefined || part.status !== "unknown") return pending;

  return replacePart(pending, partIndex, {
    status: "skipped",
    phraseName: part.phraseName,
  });
}

export type ModifyCommit = {
  /** What the target entry becomes, or null when the correction itself was skipped. */
  replacement: NewFoodItem | null;
  /** Everything else the sentence settled, stored as one new record. Never dropped. */
  additions: NewFoodItem[];
  /** Foods left out because the user did not know their calories. */
  skipped: string[];
};

/**
 * How a finished correction is written.
 *
 * The first item the correction settled replaces the target. Every other
 * settled item — a second food in the correction, or a food the sentence
 * reported beside it — is added, never discarded: storing only the first
 * was how "떡볶이랑 튀김 먹었는데 떡볶이는 반만" lost its 튀김.
 */
export function planModifyCommit(pending: PendingAdd): ModifyCommit {
  const modifyItems: NewFoodItem[] = [];
  const addItems: NewFoodItem[] = [];
  const skipped: string[] = [];
  for (const [partIndex, part] of pending.parts.entries()) {
    if (part.status === "skipped") skipped.push(part.phraseName);
    if (part.status !== "resolved") continue;
    (isModifyPart(pending, partIndex) ? modifyItems : addItems).push(part.item);
  }
  const [replacement, ...rest] = modifyItems;
  return { replacement: replacement ?? null, additions: [...rest, ...addItems], skipped };
}

/** "모르겠어", "빼고" — an answer to the calorie question that has no number. */
const SKIP_PHRASES = new Set([
  "빼고",
  "빼",
  "빼줘",
  "빼고 기록",
  "빼고 기록해줘",
  "모르겠어",
  "모르겠어요",
  "몰라",
  "몰라요",
  "모름",
]);

export function isSkipMessage(message: string): boolean {
  const normalized = message.trim().replace(/[.!?~\s]+$/u, "");
  return SKIP_PHRASES.has(normalized);
}

/**
 * Backing out of a pending question.
 *
 * A fixed vocabulary rather than another judgment call: the cost of getting
 * this wrong is a dropped meal or a stuck conversation, and these are the
 * words people actually use. Anything else is treated as an answer to the
 * question that is open.
 */
const CANCEL_PHRASES = new Set([
  "취소",
  "취소해",
  "취소할래",
  "취소해줘",
  "아니",
  "아냐",
  "아니야",
  "아니요",
  "아뇨",
  "됐어",
  "됐어요",
  "됐다",
  "그만",
  "그만할래",
  "안할래",
  "안 할래",
  "안할게",
  "안 할게",
  "그냥 안할래",
  "그냥 안 할래",
  "그냥안할래",
  "취소요",
  "no",
  "cancel",
]);

export function isCancelMessage(message: string): boolean {
  const normalized = message.trim().replace(/[.!?~\s]+$/u, "").toLowerCase();
  return CANCEL_PHRASES.has(normalized);
}
