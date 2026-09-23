import type { FoodItem, MealRecord } from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";
import { deleteMealRecord, updateMealRecord, type NewFoodItem } from "./mealRecords";

/**
 * Changing and removing food that is already logged.
 *
 * The gap this closes: Jev points at a **food item**, because that is what a
 * person refers to — "아까 먹은 갈비탕". The repository stores **records**, and
 * one record can hold several items, since "갈비탕 하나랑 밥 한 공기" is one
 * sentence and therefore one record. So every edit has to find the record a
 * item sits in before it can touch storage.
 *
 * No new CRUD. `updateMealRecord` and `deleteMealRecord` have existed and been
 * tested since Phase 3; these functions only work out which of the two to call
 * and with what.
 */

export type ItemLocation = {
  record: MealRecord;
  item: FoodItem;
  /** Where in `record.items` it sits. */
  index: number;
};

/** Finds the record holding an item. Null when the id is not on the day. */
export function locateItem(
  records: MealRecord[],
  itemId: string,
): ItemLocation | null {
  for (const record of records) {
    const index = record.items.findIndex((item) => item.id === itemId);
    const item = record.items[index];
    if (item !== undefined) return { record, item, index };
  }
  return null;
}

export type RemoveResult =
  | { status: "removed"; item: FoodItem }
  /** The id was not on the day — nothing was touched. */
  | { status: "not_found" };

/**
 * Takes one food off the log.
 *
 * Removing the last item on a record removes the record too: a record with no
 * food in it is not a meal, it is a leftover that would show as an empty row
 * and still carry the original sentence.
 */
export async function removeFoodItem(
  repository: MealRecordRepository,
  records: MealRecord[],
  itemId: string,
): Promise<RemoveResult> {
  const found = locateItem(records, itemId);
  if (found === null) return { status: "not_found" };

  const remaining = found.record.items.filter((item) => item.id !== itemId);

  if (remaining.length === 0) {
    await deleteMealRecord(repository, found.record.id);
  } else {
    await updateMealRecord(repository, found.record.id, { items: remaining });
  }

  return { status: "removed", item: found.item };
}

export type ReplaceResult =
  | { status: "replaced"; before: FoodItem; after: FoodItem }
  | { status: "not_found" };

/**
 * Swaps one food for a re-priced version of itself.
 *
 * The item keeps its id, so anything already pointing at it still does, and
 * the record keeps its original `sourceText` — what the user first said is
 * history, not something a correction should rewrite.
 */
export async function replaceFoodItem(
  repository: MealRecordRepository,
  records: MealRecord[],
  itemId: string,
  next: NewFoodItem,
): Promise<ReplaceResult> {
  const found = locateItem(records, itemId);
  if (found === null) return { status: "not_found" };

  const after: FoodItem = { ...next, id: found.item.id };
  const items = found.record.items.slice();
  items[found.index] = after;

  await updateMealRecord(repository, found.record.id, { items });

  return { status: "replaced", before: found.item, after };
}
