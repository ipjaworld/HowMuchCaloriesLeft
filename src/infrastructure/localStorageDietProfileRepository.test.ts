import { beforeEach, describe, expect, it } from "vitest";
import type { DietProfile } from "@/domain/dietProfile";
import { createLocalStorageDailyGoalRepository } from "./localStorageDailyGoalRepository";
import { createLocalStorageDietProfileRepository } from "./localStorageDietProfileRepository";
import { createLocalStorageMealRecordRepository } from "./localStorageMealRecordRepository";
import { STORAGE_KEYS, createMemoryStorage } from "./storage";

const PROFILE: DietProfile = {
  weightKg: 62.5,
  heightCm: 164,
  age: 31,
  sex: "female",
  activityLevel: "light",
  goalMode: "moderate_loss",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("localStorage diet profile repository", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let repository: ReturnType<typeof createLocalStorageDietProfileRepository>;

  beforeEach(() => {
    storage = createMemoryStorage();
    repository = createLocalStorageDietProfileRepository({
      storage,
      now: () => new Date("2026-09-27T02:00:00.000Z"),
    });
  });

  it("reads nothing when no profile was ever stored", async () => {
    await expect(repository.get()).resolves.toBeNull();
    await expect(repository.hasSeenPrompt()).resolves.toBe(false);
  });

  it("stores a profile under its own versioned key", async () => {
    await repository.set(PROFILE);
    expect(JSON.parse(storage.snapshot()[STORAGE_KEYS.dietProfile] ?? "null")).toEqual({
      version: 1,
      profile: PROFILE,
    });
    expect(STORAGE_KEYS.dietProfile).toBe("hmcl.v1.dietProfile");
  });

  it("stores the facts and the mode, never a derived figure", async () => {
    await repository.set(PROFILE);
    const stored = JSON.parse(storage.snapshot()[STORAGE_KEYS.dietProfile] ?? "{}");
    // Maintenance and the target are recomputed from the facts; the target in
    // use is the DailyGoal. A stored copy could only drift.
    expect(stored.profile).not.toHaveProperty("estimatedMaintenanceCalories");
    expect(stored.profile).not.toHaveProperty("targetCalories");
    expect(stored.profile).not.toHaveProperty("bmr");
  });

  it("survives a reload — a fresh repository over the same storage", async () => {
    await repository.set(PROFILE);
    const reloaded = createLocalStorageDietProfileRepository({ storage });
    await expect(reloaded.get()).resolves.toEqual(PROFILE);
  });

  it("treats invalid JSON as no profile", async () => {
    storage.setItem(STORAGE_KEYS.dietProfile, "{not json");
    await expect(repository.get()).resolves.toBeNull();
  });

  it("treats a schema mismatch as no profile", async () => {
    for (const profile of [
      { ...PROFILE, weightKg: "62" },
      { ...PROFILE, age: 12 },
      { ...PROFILE, age: 30.5 },
      { ...PROFILE, sex: "other" },
      { ...PROFILE, activityLevel: "athlete" },
      { ...PROFILE, goalMode: "extreme" },
      { ...PROFILE, updatedAt: "yesterday" },
      { weightKg: 60 },
    ]) {
      storage.setItem(STORAGE_KEYS.dietProfile, JSON.stringify({ version: 1, profile }));
      await expect(repository.get()).resolves.toBeNull();
    }
  });

  it("treats another envelope version as no profile rather than guessing", async () => {
    storage.setItem(STORAGE_KEYS.dietProfile, JSON.stringify({ version: 2, profile: PROFILE }));
    await expect(repository.get()).resolves.toBeNull();

    storage.setItem(STORAGE_KEYS.dietProfile, JSON.stringify(PROFILE));
    await expect(repository.get()).resolves.toBeNull();
  });

  it("refuses to write a profile it could not read back", async () => {
    await expect(repository.set({ ...PROFILE, age: 5 })).rejects.toThrow();
    expect(storage.snapshot()[STORAGE_KEYS.dietProfile]).toBeUndefined();
  });

  it("clears the profile", async () => {
    await repository.set(PROFILE);
    await repository.clear();
    await expect(repository.get()).resolves.toBeNull();
  });

  it("remembers that the first-visit prompt was answered", async () => {
    await repository.markPromptSeen();
    await expect(repository.hasSeenPrompt()).resolves.toBe(true);
    const reloaded = createLocalStorageDietProfileRepository({ storage });
    await expect(reloaded.hasSeenPrompt()).resolves.toBe(true);
  });

  it("treats a corrupt onboarding flag as not seen", async () => {
    storage.setItem(STORAGE_KEYS.onboarding, "true");
    await expect(repository.hasSeenPrompt()).resolves.toBe(false);
  });

  it("works with no browser storage at all", async () => {
    const ssr = createLocalStorageDietProfileRepository();
    await expect(ssr.get()).resolves.toBeNull();
    await expect(ssr.set(PROFILE)).resolves.toBeUndefined();
  });
});

describe("the profile is independent of the other stored data", () => {
  it("leaves meals and goals untouched, and is left untouched by them", async () => {
    const storage = createMemoryStorage();
    const profiles = createLocalStorageDietProfileRepository({ storage });
    const goals = createLocalStorageDailyGoalRepository({ storage });
    const meals = createLocalStorageMealRecordRepository({ storage });

    await goals.set({ date: "2026-09-27", calorieTarget: 1700 });
    await profiles.set(PROFILE);
    await profiles.clear();

    // Clearing the profile does not take the goal it produced with it.
    await expect(goals.get("2026-09-27")).resolves.toEqual({
      date: "2026-09-27",
      calorieTarget: 1700,
    });
    await expect(meals.getByDate("2026-09-27")).resolves.toEqual([]);

    // And a corrupt meal log does not blank the profile.
    await profiles.set(PROFILE);
    storage.setItem(STORAGE_KEYS.mealRecords, "garbage");
    await expect(profiles.get()).resolves.toEqual(PROFILE);
  });

  it("uses a key no other repository writes", () => {
    const keys = Object.values(STORAGE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
