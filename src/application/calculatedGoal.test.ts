import { beforeEach, describe, expect, it } from "vitest";
import type { BodyFacts } from "@/domain/dietProfile";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageDietProfileRepository } from "@/infrastructure/localStorageDietProfileRepository";
import { createMemoryStorage } from "@/infrastructure/storage";
import { adoptCalculatedGoal, shouldOfferCalculator } from "./calculatedGoal";
import { getEffectiveDailyGoal, setDailyGoal } from "./dailyGoal";

/**
 * The onboarding flow, minus the React: whether the prompt shows, and what
 * each answer leaves in storage. The screen only sequences these calls.
 */

// 1320.25 × 1.2 = 1584.3 → maintenance 1580; −300 = 1280; −700 = 880.
const FACTS: BodyFacts = {
  weightKg: 60,
  heightCm: 165,
  age: 30,
  sex: "female",
  activityLevel: "sedentary",
};

// 1755 × 1.55 = 2720.25 → 2720; −300 = 2420; −700 = 2020.
const MAN: BodyFacts = {
  weightKg: 80,
  heightCm: 180,
  age: 35,
  sex: "male",
  activityLevel: "moderate",
};

const DAY = "2026-09-27";
const NOW = new Date("2026-09-27T03:00:00.000Z");

function setup() {
  const storage = createMemoryStorage();
  return {
    storage,
    goals: createLocalStorageDailyGoalRepository({ storage }),
    profile: createLocalStorageDietProfileRepository({ storage, now: () => NOW }),
  };
}

describe("the first-visit prompt", () => {
  it("shows on a true first visit", () => {
    expect(shouldOfferCalculator({ hasGoal: false, hasProfile: false, promptSeen: false })).toBe(true);
  });

  it("does not interrupt someone who already set a goal by hand", () => {
    expect(shouldOfferCalculator({ hasGoal: true, hasProfile: false, promptSeen: false })).toBe(false);
  });

  it("does not come back once answered — either way", () => {
    expect(shouldOfferCalculator({ hasGoal: false, hasProfile: false, promptSeen: true })).toBe(false);
    expect(shouldOfferCalculator({ hasGoal: false, hasProfile: true, promptSeen: false })).toBe(false);
  });

  it("is not shown again after a skip, across a reload", async () => {
    const { storage, profile } = setup();
    // "직접 입력할게요" or ESC.
    await profile.markPromptSeen();

    const reloaded = createLocalStorageDietProfileRepository({ storage });
    expect(
      shouldOfferCalculator({
        hasGoal: false,
        hasProfile: (await reloaded.get()) !== null,
        promptSeen: await reloaded.hasSeenPrompt(),
      }),
    ).toBe(false);
  });
});

describe("skipping to a typed goal", () => {
  it("stores the goal and no profile at all", async () => {
    const repositories = setup();
    await repositories.profile.markPromptSeen();
    await setDailyGoal(repositories.goals, DAY, 1800);

    await expect(getEffectiveDailyGoal(repositories.goals, DAY)).resolves.toEqual({
      date: DAY,
      calorieTarget: 1800,
    });
    await expect(repositories.profile.get()).resolves.toBeNull();
  });
});

describe("adopting a calculated target", () => {
  let repositories: ReturnType<typeof setup>;
  beforeEach(() => {
    repositories = setup();
  });

  it("writes an ordinary DailyGoal and the facts behind it", async () => {
    const result = await adoptCalculatedGoal(repositories, {
      date: DAY,
      facts: FACTS,
      goalMode: "moderate_loss",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, goal: { date: DAY, calorieTarget: 1280 } });
    await expect(repositories.goals.get(DAY)).resolves.toEqual({ date: DAY, calorieTarget: 1280 });
    await expect(repositories.profile.get()).resolves.toEqual({
      ...FACTS,
      goalMode: "moderate_loss",
      updatedAt: NOW.toISOString(),
    });
    await expect(repositories.profile.hasSeenPrompt()).resolves.toBe(true);
  });

  it("uses maintenance itself for 유지", async () => {
    const result = await adoptCalculatedGoal(repositories, {
      date: DAY,
      facts: MAN,
      goalMode: "maintenance",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, goal: { calorieTarget: 2720 } });
  });

  it("switches mode by adopting again", async () => {
    await adoptCalculatedGoal(repositories, { date: DAY, facts: MAN, goalMode: "moderate_loss", now: NOW });
    await expect(repositories.goals.get(DAY)).resolves.toMatchObject({ calorieTarget: 2420 });

    await adoptCalculatedGoal(repositories, { date: DAY, facts: MAN, goalMode: "fast_loss", now: NOW });
    await expect(repositories.goals.get(DAY)).resolves.toMatchObject({ calorieTarget: 2020 });
    await expect(repositories.profile.get()).resolves.toMatchObject({ goalMode: "fast_loss" });
  });

  it("refuses a mode below the suggestion floor and changes nothing", async () => {
    // 880 < 1200 for this person.
    const result = await adoptCalculatedGoal(repositories, {
      date: DAY,
      facts: FACTS,
      goalMode: "fast_loss",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_adoptable" });
    await expect(repositories.goals.get(DAY)).resolves.toBeNull();
    await expect(repositories.profile.get()).resolves.toBeNull();
  });

  it("refuses facts out of range and changes nothing", async () => {
    const result = await adoptCalculatedGoal(repositories, {
      date: DAY,
      facts: { ...FACTS, age: 15 },
      goalMode: "maintenance",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_facts" });
    await expect(repositories.profile.get()).resolves.toBeNull();
  });

  it("leaves no profile behind if the goal itself is rejected", async () => {
    const result = await adoptCalculatedGoal(repositories, {
      date: "not-a-date",
      facts: FACTS,
      goalMode: "maintenance",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "goal_rejected" });
    await expect(repositories.profile.get()).resolves.toBeNull();
  });
});

describe("the manual field keeps the last word", () => {
  it("overrides a calculated target, and the profile stays for next time", async () => {
    const repositories = setup();
    await adoptCalculatedGoal(repositories, { date: DAY, facts: MAN, goalMode: "moderate_loss", now: NOW });

    await setDailyGoal(repositories.goals, DAY, 2200);

    await expect(repositories.goals.get(DAY)).resolves.toEqual({ date: DAY, calorieTarget: 2200 });
    // Reopening the calculator is an edit: the facts are still there.
    await expect(repositories.profile.get()).resolves.toMatchObject(MAN);
  });

  it("can set a number below the suggestion floor by hand", async () => {
    // The floor governs what the app suggests, not what a person may choose.
    const repositories = setup();
    const result = await setDailyGoal(repositories.goals, DAY, 1000);
    expect(result.ok).toBe(true);
  });
});
