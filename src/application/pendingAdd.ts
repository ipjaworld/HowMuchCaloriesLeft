import type { AddPart } from "./addFood";
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
  target?: { itemId: string; foodName: string };
};

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
      reason: "missing_serving";
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
    return {
      type: "confirm_add",
      mode: pending.target === undefined ? "add" : "modify",
      names: pending.parts
        .filter((part) => part.status !== "unknown")
        .map((part) => part.phraseName),
    };
  }

  for (const [partIndex, part] of pending.parts.entries()) {
    if (part.status === "ambiguous") {
      return {
        type: "choose_food",
        partIndex,
        mode: pending.target === undefined ? "add" : "modify",
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
