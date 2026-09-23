import { describe, expect, it, vi } from "vitest";
import type { FoodItem, MealRecord } from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";
import { locateItem, removeFoodItem, replaceFoodItem } from "./editFood";

/**
 * Editing what is already logged.
 *
 * The thing worth testing here is the seam Phase 6B had to cross: Jev names a
 * *food item*, storage holds *records*, and one record can hold several items.
 * So a delete is sometimes a record delete and sometimes a record update, and
 * picking wrong either loses a meal or leaves an empty one behind.
 */

function item(id: string, name: string, calories: number): FoodItem {
  return { id, name, amount: "하나", calories, caloriesEstimated: false };
}

function record(id: string, items: FoodItem[]): MealRecord {
  return {
    id,
    consumedAt: "2026-09-23T12:30:00+09:00",
    sourceText: items.map((i) => i.name).join(" "),
    items,
    createdAt: "2026-09-23T12:30:00+09:00",
    updatedAt: "2026-09-23T12:30:00+09:00",
  };
}

function fakeRepository(initial: MealRecord[]) {
  const records = initial.map((r) => ({ ...r, items: [...r.items] }));
  const update = vi.fn(async (id: string, input: Partial<MealRecord>) => {
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records[index] = { ...records[index]!, ...input };
  });
  const remove = vi.fn(async (id: string) => {
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  });
  const repository: MealRecordRepository = {
    add: async () => undefined,
    getByDate: async () => records,
    update,
    remove,
  };
  return { repository, update, remove, records };
}

const SINGLE = record("r1", [item("i-galbitang", "갈비탕", 362)]);
const PAIR = record("r2", [
  item("i-galbitang2", "갈비탕", 362),
  item("i-rice", "쌀밥", 351),
]);

describe("locateItem", () => {
  it("finds the record an item belongs to", () => {
    const found = locateItem([SINGLE, PAIR], "i-rice");
    expect(found?.record.id).toBe("r2");
    expect(found?.item.name).toBe("쌀밥");
    expect(found?.index).toBe(1);
  });

  it("returns null for an id that is not on the day", () => {
    expect(locateItem([SINGLE], "nope")).toBeNull();
  });
});

describe("removeFoodItem", () => {
  it("deletes the whole record when it held nothing else", async () => {
    const { repository, update, remove, records } = fakeRepository([SINGLE]);
    const result = await removeFoodItem(repository, [SINGLE], "i-galbitang");

    expect(result).toMatchObject({ status: "removed" });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(0);
    expect(records).toHaveLength(0);
  });

  it("keeps the record and drops one item when others remain", async () => {
    // "갈비탕 하나랑 밥 한 공기" is one record with two items; deleting the
    // 갈비탕 must not take the 쌀밥 with it.
    const { repository, update, remove, records } = fakeRepository([PAIR]);
    const result = await removeFoodItem(repository, [PAIR], "i-galbitang2");

    expect(result).toMatchObject({ status: "removed" });
    expect(remove).toHaveBeenCalledTimes(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(records[0]?.items.map((i) => i.name)).toEqual(["쌀밥"]);
  });

  it("changes nothing when the target is not there", async () => {
    const { repository, update, remove, records } = fakeRepository([SINGLE, PAIR]);
    const result = await removeFoodItem(repository, [SINGLE, PAIR], "ghost");

    expect(result).toEqual({ status: "not_found" });
    expect(update).toHaveBeenCalledTimes(0);
    expect(remove).toHaveBeenCalledTimes(0);
    expect(records).toHaveLength(2);
    expect(records.flatMap((r) => r.items)).toHaveLength(3);
  });

  it("names what it removed, so the reply can say so", async () => {
    const { repository } = fakeRepository([PAIR]);
    const result = await removeFoodItem(repository, [PAIR], "i-rice");
    if (result.status !== "removed") throw new Error("expected removal");
    expect(result.item.name).toBe("쌀밥");
    expect(result.item.calories).toBe(351);
  });
});

describe("replaceFoodItem", () => {
  it("re-prices one item and leaves the rest of the record alone", async () => {
    const { repository, update, records } = fakeRepository([PAIR]);
    const result = await replaceFoodItem(repository, [PAIR], "i-rice", {
      name: "쌀밥",
      amount: "반 공기",
      calories: 176,
      caloriesEstimated: false,
    });

    expect(result).toMatchObject({ status: "replaced" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(records[0]?.items.map((i) => [i.name, i.calories])).toEqual([
      ["갈비탕", 362],
      ["쌀밥", 176],
    ]);
  });

  it("keeps the item's id so anything pointing at it still does", async () => {
    const { repository, records } = fakeRepository([SINGLE]);
    await replaceFoodItem(repository, [SINGLE], "i-galbitang", {
      name: "갈비탕",
      amount: "반 그릇",
      calories: 181,
      caloriesEstimated: false,
    });
    expect(records[0]?.items[0]?.id).toBe("i-galbitang");
  });

  it("keeps the original sentence — a correction is not a rewrite of history", async () => {
    const { repository, records } = fakeRepository([SINGLE]);
    await replaceFoodItem(repository, [SINGLE], "i-galbitang", {
      name: "갈비탕",
      amount: "반 그릇",
      calories: 181,
      caloriesEstimated: false,
    });
    expect(records[0]?.sourceText).toBe(SINGLE.sourceText);
  });

  it("changes nothing when the target is not there", async () => {
    const { repository, update, records } = fakeRepository([SINGLE]);
    const result = await replaceFoodItem(repository, [SINGLE], "ghost", {
      name: "갈비탕",
      calories: 1,
      caloriesEstimated: false,
    });

    expect(result).toEqual({ status: "not_found" });
    expect(update).toHaveBeenCalledTimes(0);
    expect(records[0]?.items[0]?.calories).toBe(362);
  });
});
