import { beforeEach, describe, expect, it } from "vitest";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { STORAGE_KEYS, createMemoryStorage } from "@/infrastructure/storage";
import { DAILY_GOAL_RANGE, getEffectiveDailyGoal, setDailyGoal } from "./dailyGoal";

describe("daily goal", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let repository: ReturnType<typeof createLocalStorageDailyGoalRepository>;

  beforeEach(() => {
    storage = createMemoryStorage();
    repository = createLocalStorageDailyGoalRepository({ storage });
  });

  it("has no goal before one is set", async () => {
    await expect(repository.get("2026-09-20")).resolves.toBeNull();
  });

  it("stores a goal and reads it back", async () => {
    const result = await setDailyGoal(repository, "2026-09-20", 2100);
    expect(result).toEqual({
      ok: true,
      goal: { date: "2026-09-20", calorieTarget: 2100 },
    });
    await expect(repository.get("2026-09-20")).resolves.toEqual({
      date: "2026-09-20",
      calorieTarget: 2100,
    });
  });

  it("replaces the goal for a date rather than stacking duplicates", async () => {
    await setDailyGoal(repository, "2026-09-20", 2100);
    await setDailyGoal(repository, "2026-09-20", 1800);

    await expect(repository.getExact("2026-09-20")).resolves.toEqual({
      date: "2026-09-20",
      calorieTarget: 1800,
    });

    const stored = JSON.parse(storage.getItem(STORAGE_KEYS.dailyGoals) ?? "{}") as {
      goals: unknown[];
    };
    expect(stored.goals).toHaveLength(1);
  });

  it("keeps goals per date", async () => {
    await setDailyGoal(repository, "2026-09-19", 2000);
    await setDailyGoal(repository, "2026-09-20", 1800);

    await expect(repository.getExact("2026-09-19")).resolves.toMatchObject({
      calorieTarget: 2000,
    });
    await expect(repository.getExact("2026-09-20")).resolves.toMatchObject({
      calorieTarget: 1800,
    });
  });

  it("carries the last goal forward to a later date", async () => {
    await setDailyGoal(repository, "2026-09-18", 2000);

    await expect(repository.getExact("2026-09-20")).resolves.toBeNull();
    await expect(getEffectiveDailyGoal(repository, "2026-09-20")).resolves.toEqual(
      { date: "2026-09-18", calorieTarget: 2000 },
    );
  });

  it("does not carry a goal backwards in time", async () => {
    await setDailyGoal(repository, "2026-09-20", 2000);
    await expect(getEffectiveDailyGoal(repository, "2026-09-19")).resolves.toBeNull();
  });

  it("picks the most recent applicable goal", async () => {
    await setDailyGoal(repository, "2026-09-01", 2500);
    await setDailyGoal(repository, "2026-09-15", 2000);

    await expect(getEffectiveDailyGoal(repository, "2026-09-20")).resolves.toMatchObject(
      { date: "2026-09-15", calorieTarget: 2000 },
    );
  });

  it("survives a reload", async () => {
    await setDailyGoal(repository, "2026-09-20", 2100);

    const reopened = createLocalStorageDailyGoalRepository({ storage });
    await expect(reopened.get("2026-09-20")).resolves.toMatchObject({
      calorieTarget: 2100,
    });
  });

  describe("validation — technical bounds, not health advice", () => {
    it("rejects a value below the range", async () => {
      const result = await setDailyGoal(
        repository,
        "2026-09-20",
        DAILY_GOAL_RANGE.min - 1,
      );
      expect(result).toEqual({ ok: false, reason: "out_of_range" });
      await expect(repository.get("2026-09-20")).resolves.toBeNull();
    });

    it("rejects a value above the range", async () => {
      const result = await setDailyGoal(
        repository,
        "2026-09-20",
        DAILY_GOAL_RANGE.max + 1,
      );
      expect(result).toEqual({ ok: false, reason: "out_of_range" });
    });

    it("accepts both ends of the range", async () => {
      await expect(
        setDailyGoal(repository, "2026-09-20", DAILY_GOAL_RANGE.min),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        setDailyGoal(repository, "2026-09-21", DAILY_GOAL_RANGE.max),
      ).resolves.toMatchObject({ ok: true });
    });

    it("rejects NaN and non-integers", async () => {
      await expect(
        setDailyGoal(repository, "2026-09-20", Number.NaN),
      ).resolves.toEqual({ ok: false, reason: "not_a_number" });
      await expect(
        setDailyGoal(repository, "2026-09-20", 2100.5),
      ).resolves.toEqual({ ok: false, reason: "not_a_number" });
      await expect(
        setDailyGoal(repository, "2026-09-20", Number.POSITIVE_INFINITY),
      ).resolves.toEqual({ ok: false, reason: "not_a_number" });
    });

    it("rejects a malformed date key", async () => {
      await expect(setDailyGoal(repository, "2026-02-30", 2100)).resolves.toEqual({
        ok: false,
        reason: "invalid_date",
      });
    });
  });

  describe("bad stored data", () => {
    it("falls back to no goal on invalid JSON", async () => {
      storage.setItem(STORAGE_KEYS.dailyGoals, "not json at all");
      await expect(repository.get("2026-09-20")).resolves.toBeNull();
    });

    it("drops goals that fail the schema and keeps the rest", async () => {
      storage.setItem(
        STORAGE_KEYS.dailyGoals,
        JSON.stringify({
          version: 1,
          goals: [
            { date: "2026-09-18", calorieTarget: 2000 },
            { date: "2026-02-30", calorieTarget: 2000 },
            { date: "2026-09-19", calorieTarget: 99_999_999 },
            { date: "2026-09-19", calorieTarget: "2000" },
          ],
        }),
      );

      await expect(repository.get("2026-09-20")).resolves.toEqual({
        date: "2026-09-18",
        calorieTarget: 2000,
      });
    });
  });
});
