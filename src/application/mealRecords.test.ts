import { beforeEach, describe, expect, it } from "vitest";
import { calculateDailyCalories } from "@/domain/calories";
import { toDateKey } from "@/domain/date";
import { MAX_FOOD_ITEM_CALORIES } from "@/domain/limits";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { createMemoryStorage } from "@/infrastructure/storage";
import { addMealRecord, deleteMealRecord, updateMealRecord } from "./mealRecords";

const DAY = new Date(2026, 8, 20, 12, 40);
const DATE_KEY = toDateKey(DAY);

describe("meal record use cases", () => {
  let repository: ReturnType<typeof createLocalStorageMealRecordRepository>;
  let nextId: number;

  const deps = {
    now: () => DAY,
    createId: () => `id-${nextId++}`,
  };

  beforeEach(() => {
    nextId = 1;
    repository = createLocalStorageMealRecordRepository({
      storage: createMemoryStorage(),
      now: () => DAY,
    });
  });

  it("adds a record, giving the record and every item an id", async () => {
    const record = await addMealRecord(
      repository,
      {
        sourceText: "갈비탕이랑 밥 한 공기 먹음",
        mealType: "lunch",
        items: [
          { name: "갈비탕", calories: 650, caloriesEstimated: false },
          {
            name: "흰쌀밥",
            amount: "1공기",
            calories: 320,
            caloriesEstimated: true,
          },
        ],
      },
      deps,
    );

    expect(record.id).toBe("id-1");
    expect(record.items.map((i) => i.id)).toEqual(["id-2", "id-3"]);
    expect(record.consumedAt).toBe(DAY.toISOString());
    expect(record.createdAt).toBe(record.updatedAt);

    const stored = await repository.getByDate(DATE_KEY);
    expect(calculateDailyCalories(stored)).toBe(970);
  });

  it("leaves mealType off when it was not given", async () => {
    const record = await addMealRecord(
      repository,
      { sourceText: "커피", items: [{ name: "아메리카노", calories: 10, caloriesEstimated: false }] },
      deps,
    );
    expect(record.mealType).toBeUndefined();
  });

  it("honours an explicit consumedAt", async () => {
    const earlier = new Date(2026, 8, 20, 8, 0).toISOString();
    const record = await addMealRecord(
      repository,
      {
        sourceText: "아침",
        consumedAt: earlier,
        items: [{ name: "삼각김밥", calories: 210, caloriesEstimated: false }],
      },
      deps,
    );
    expect(record.consumedAt).toBe(earlier);
  });

  it("refuses an unusable calorie value before it reaches storage", async () => {
    await expect(
      addMealRecord(
        repository,
        {
          sourceText: "이상한 값",
          items: [{ name: "무엇", calories: Number.NaN, caloriesEstimated: true }],
        },
        deps,
      ),
    ).rejects.toThrow(/Unusable calorie value/);

    await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
  });

  it.each([-1, MAX_FOOD_ITEM_CALORIES + 1, Number.POSITIVE_INFINITY])(
    "refuses %s kcal",
    async (calories) => {
      await expect(
        addMealRecord(
          repository,
          { sourceText: "x", items: [{ name: "무엇", calories, caloriesEstimated: false }] },
          deps,
        ),
      ).rejects.toThrow();
    },
  );

  it("updates a record's items", async () => {
    const record = await addMealRecord(
      repository,
      {
        sourceText: "갈비탕이랑 밥 한 공기",
        items: [
          { name: "갈비탕", calories: 650, caloriesEstimated: false },
          { name: "흰쌀밥", calories: 320, caloriesEstimated: false },
        ],
      },
      deps,
    );

    await updateMealRecord(repository, record.id, {
      items: [
        { id: "id-2", name: "갈비탕", calories: 650, caloriesEstimated: false },
        { id: "id-3", name: "흰쌀밥", amount: "반 공기", calories: 160, caloriesEstimated: true },
      ],
    });

    const stored = await repository.getByDate(DATE_KEY);
    expect(calculateDailyCalories(stored)).toBe(810);
  });

  it("refuses an update carrying an unusable calorie value", async () => {
    const record = await addMealRecord(
      repository,
      { sourceText: "x", items: [{ name: "갈비탕", calories: 650, caloriesEstimated: false }] },
      deps,
    );

    await expect(
      updateMealRecord(repository, record.id, {
        items: [{ id: "i", name: "갈비탕", calories: -5, caloriesEstimated: false }],
      }),
    ).rejects.toThrow();

    const stored = await repository.getByDate(DATE_KEY);
    expect(calculateDailyCalories(stored)).toBe(650);
  });

  it("deletes a record", async () => {
    const record = await addMealRecord(
      repository,
      { sourceText: "커피", items: [{ name: "아메리카노", calories: 10, caloriesEstimated: false }] },
      deps,
    );

    await deleteMealRecord(repository, record.id);
    await expect(repository.getByDate(DATE_KEY)).resolves.toEqual([]);
  });

  it("generates real unique ids with the default id source", async () => {
    const first = await addMealRecord(repository, {
      sourceText: "a",
      items: [{ name: "갈비탕", calories: 650, caloriesEstimated: false }],
    });
    const second = await addMealRecord(repository, {
      sourceText: "b",
      items: [{ name: "김치", calories: 35, caloriesEstimated: false }],
    });

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
