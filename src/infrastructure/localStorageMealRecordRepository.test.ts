import { beforeEach, describe, expect, it } from "vitest";
import { toDateKey } from "@/domain/date";
import type { MealRecord } from "@/domain/meal";
import { createLocalStorageMealRecordRepository } from "./localStorageMealRecordRepository";
import { STORAGE_KEYS, createMemoryStorage } from "./storage";

const DAY = new Date(2026, 8, 20, 12, 40);
const DATE_KEY = toDateKey(DAY);
const OTHER_DAY = new Date(2026, 8, 19, 12, 40);

function makeRecord(overrides: Partial<MealRecord> = {}): MealRecord {
  const iso = DAY.toISOString();
  return {
    id: "r1",
    consumedAt: iso,
    mealType: "lunch",
    sourceText: "갈비탕이랑 밥 한 공기 먹음",
    items: [
      { id: "i1", name: "갈비탕", calories: 650, caloriesEstimated: false },
      {
        id: "i2",
        name: "흰쌀밥",
        amount: "1공기",
        calories: 320,
        caloriesEstimated: true,
      },
    ],
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  };
}

function envelope(records: unknown[]): string {
  return JSON.stringify({ version: 1, records });
}

describe("localStorage meal record repository", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let repository: ReturnType<typeof createLocalStorageMealRecordRepository>;

  beforeEach(() => {
    storage = createMemoryStorage();
    repository = createLocalStorageMealRecordRepository({
      storage,
      now: () => new Date(2026, 8, 20, 18, 0),
    });
  });

  it("reads an empty list when nothing was ever stored", async () => {
    await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
  });

  it("adds a record and reads it back", async () => {
    const record = makeRecord();
    await repository.add(record);
    await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([record]);
  });

  it("survives a reload — a fresh repository over the same storage", async () => {
    await repository.add(makeRecord());

    const reopened = createLocalStorageMealRecordRepository({ storage });
    const restored = await reopened.getByDate(DATE_KEY);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.items).toHaveLength(2);
  });

  it("only returns records consumed on the requested local date", async () => {
    await repository.add(makeRecord());
    await repository.add(
      makeRecord({ id: "r2", consumedAt: OTHER_DAY.toISOString() }),
    );

    const today = await repository.getByDate(DATE_KEY);
    expect(today.map((r) => r.id)).toEqual(["r1"]);
  });

  it("returns a day's records in the order they were consumed", async () => {
    await repository.add(
      makeRecord({ id: "late", consumedAt: new Date(2026, 8, 20, 19, 0).toISOString() }),
    );
    await repository.add(
      makeRecord({ id: "early", consumedAt: new Date(2026, 8, 20, 8, 0).toISOString() }),
    );

    const records = await repository.getByDate(DATE_KEY);
    expect(records.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("updates a record and stamps updatedAt", async () => {
    await repository.add(makeRecord());
    await repository.update("r1", {
      items: [{ id: "i2", name: "흰쌀밥", calories: 160, caloriesEstimated: true }],
    });

    const [updated] = await repository.getByDate(DATE_KEY);
    expect(updated?.items).toHaveLength(1);
    expect(updated?.items[0]?.calories).toBe(160);
    expect(updated?.updatedAt).toBe(new Date(2026, 8, 20, 18, 0).toISOString());
    expect(updated?.createdAt).toBe(DAY.toISOString());
  });

  it("ignores an update for an unknown id", async () => {
    await repository.add(makeRecord());
    await repository.update("nope", { sourceText: "바뀜" });
    const [record] = await repository.getByDate(DATE_KEY);
    expect(record?.sourceText).toBe("갈비탕이랑 밥 한 공기 먹음");
  });

  it("removes a record", async () => {
    await repository.add(makeRecord());
    await repository.remove("r1");
    await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
  });

  it("ignores a remove for an unknown id", async () => {
    await repository.add(makeRecord());
    await repository.remove("nope");
    await expect(repository.getByDate(DATE_KEY)).resolves.toHaveLength(1);
  });

  describe("bad stored data", () => {
    it("falls back to empty on invalid JSON", async () => {
      storage.setItem(STORAGE_KEYS.mealRecords, "{ this is not json");
      await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
    });

    it("falls back to empty when the envelope is not an object", async () => {
      storage.setItem(STORAGE_KEYS.mealRecords, JSON.stringify("nope"));
      await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
    });

    it("falls back to empty when records is not an array", async () => {
      storage.setItem(
        STORAGE_KEYS.mealRecords,
        JSON.stringify({ version: 1, records: { r1: {} } }),
      );
      await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
    });

    it("drops only the broken records and keeps the good ones", async () => {
      const good = makeRecord();
      storage.setItem(
        STORAGE_KEYS.mealRecords,
        envelope([
          good,
          { id: "missing-fields" },
          makeRecord({ id: "bad-calories", items: [
            { id: "x", name: "무엇", calories: Number.NaN, caloriesEstimated: false },
          ] }),
          makeRecord({ id: "negative", items: [
            { id: "y", name: "무엇", calories: -50, caloriesEstimated: false },
          ] }),
          makeRecord({ id: "absurd", items: [
            { id: "z", name: "무엇", calories: 1e9, caloriesEstimated: false },
          ] }),
          makeRecord({ id: "unparseable-date", consumedAt: "점심때" }),
        ]),
      );

      const records = await repository.getByDate(DATE_KEY);
      expect(records.map((r) => r.id)).toEqual(["r1"]);
    });

    it("drops a record whose calories arrived as a string", async () => {
      storage.setItem(
        STORAGE_KEYS.mealRecords,
        envelope([
          makeRecord({ id: "stringy", items: [
            { id: "s", name: "무엇", calories: "320", caloriesEstimated: false },
          ] } as unknown as Partial<MealRecord>),
        ]),
      );
      await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
    });

    it("does not throw when writing over corrupt storage", async () => {
      storage.setItem(STORAGE_KEYS.mealRecords, "broken");
      await expect(repository.add(makeRecord())).resolves.toBeUndefined();
      await expect(repository.getByDate(DATE_KEY)).resolves.toHaveLength(1);
    });
  });
});
