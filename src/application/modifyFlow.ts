import {
  isSameAs,
  isSettled,
  isUnreadCorrectionOf,
  itemsOf,
  namesASubstitution,
  preferTargetFood,
  type AddPart,
} from "./addFood";
import { locateItem } from "./editFood";
import type { PendingAdd } from "./pendingAdd";
import type { FoodItem, MealRecord } from "@/domain/meal";

/**
 * "아까 거 800칼로리였어" corrects the figure, not the food. The label read
 * from that sentence is "거" or nothing, so a user-stated figure keeps the
 * name and amount of the entry it corrects — unless the sentence names a
 * replacement ("갈비탕 말고 쌀국수 700칼로리"), where the new name is the
 * point.
 */
function keepTargetName(
  parts: AddPart[],
  target: { name: string; amount?: string },
  substitutes: boolean,
): AddPart[] {
  if (substitutes) return parts;
  return parts.map((part) => {
    if (part.status !== "resolved" || part.item.calorieSource !== "user") {
      return part;
    }
    return {
      ...part,
      phraseName: target.name,
      item: {
        ...part.item,
        name: target.name,
        ...(target.amount === undefined ? {} : { amount: target.amount }),
      },
    };
  });
}

export type ModifyStart =
  /** The entry is no longer on the day. Nothing else is touched in its place. */
  | { kind: "gone" }
  /** The correction cannot be read, but the sentence also added foods: confirm those. */
  | { kind: "add_instead"; parts: AddPart[] }
  /** "2개라니까" about an entry already at 2개. */
  | { kind: "already_logged"; item: FoodItem }
  /** A correction the parser cannot read: ask the amount of this entry. */
  | { kind: "ask_amount"; itemId: string }
  /** Ready to ask or apply. `pending.target.itemId` is the entry that will change. */
  | { kind: "pending"; pending: PendingAdd };

/**
 * How the browser starts a correction the server proposed — pulled out of
 * the screen so the path from "which entry" to "which entry changes" is
 * testable without a DOM.
 *
 * A correction runs the same pipeline as an add, then lands on one item. The
 * only thing it adds is the target: knowing the entry is 쌀밥 collapses the
 * ambiguity in "밥 반만 먹었어" before anyone is asked about it. When the
 * re-priced result matches what is already stored, the sentence was one the
 * phrase parser could not read — so it asks for the amount rather than
 * reporting a change that did not happen.
 */
export function planModifyStart(
  records: MealRecord[],
  command: {
    targetId: string;
    sourceText: string;
    parts: AddPart[];
    needsConfirmation: boolean;
    extraParts?: AddPart[];
  },
  now: string,
): ModifyStart {
  const found = locateItem(records, command.targetId);
  if (found === null) return { kind: "gone" };

  const extraParts = command.extraParts ?? [];
  const substitutes = namesASubstitution(command.sourceText);
  const narrowed = keepTargetName(
    preferTargetFood(command.parts, found.item.name, substitutes),
    found.item,
    substitutes,
  );

  const only = itemsOf(narrowed)[0];
  const nothingChanged = isSettled(narrowed) && only !== undefined && isSameAs(only, found.item);
  const unreadable =
    narrowed.length === 0 ||
    nothingChanged ||
    isUnreadCorrectionOf(narrowed, found.item.name, substitutes);

  // The correction changes nothing or cannot be read, but the sentence also
  // named other foods. Those still go ahead — as an add the user confirms,
  // which names them — rather than vanishing behind "how much was it?".
  if (unreadable && extraParts.length > 0) return { kind: "add_instead", parts: extraParts };

  if (
    nothingChanged &&
    only?.amount !== undefined &&
    only.amount.replace(/\s+/g, "") === found.item.amount?.replace(/\s+/g, "")
  ) {
    return { kind: "already_logged", item: found.item };
  }

  if (unreadable) return { kind: "ask_amount", itemId: command.targetId };

  return {
    kind: "pending",
    pending: {
      sourceText: command.sourceText,
      now,
      parts: [...narrowed, ...extraParts],
      needsConfirmation: command.needsConfirmation,
      target: {
        itemId: command.targetId,
        foodName: found.item.name,
        ...(found.item.amount === undefined ? {} : { amount: found.item.amount }),
        consumedAt: found.record.consumedAt,
        modifyParts: narrowed.length,
      },
    },
  };
}
