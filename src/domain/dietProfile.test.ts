import { describe, expect, it } from "vitest";
import { MIN_DAILY_GOAL_CALORIES } from "./limits";
import {
  ACTIVITY_MULTIPLIERS,
  SUGGESTED_TARGET_FLOOR,
  basalMetabolicRate,
  estimatedMaintenance,
  invalidFields,
  isAdoptable,
  optionFor,
  planFor,
  type BodyFacts,
} from "./dietProfile";

/**
 * Every expected number below is worked by hand from the published
 * Mifflin-St Jeor equation, not read off the implementation:
 *
 *   BMR = 10·kg + 6.25·cm − 5·age + (5 male | −161 female)
 */

const WOMAN: BodyFacts = {
  weightKg: 60,
  heightCm: 165,
  age: 30,
  sex: "female",
  activityLevel: "sedentary",
};

const MAN: BodyFacts = {
  weightKg: 80,
  heightCm: 180,
  age: 35,
  sex: "male",
  activityLevel: "moderate",
};

describe("BMR — Mifflin-St Jeor", () => {
  it("matches the equation for a woman", () => {
    // 600 + 1031.25 − 150 − 161
    expect(basalMetabolicRate(WOMAN)).toBeCloseTo(1320.25, 6);
  });

  it("matches the equation for a man", () => {
    // 800 + 1125 − 175 + 5
    expect(basalMetabolicRate(MAN)).toBeCloseTo(1755, 6);
  });

  it("differs by exactly 166 kcal between sexes, all else equal", () => {
    const asMan = basalMetabolicRate({ ...WOMAN, sex: "male" });
    expect(asMan - basalMetabolicRate(WOMAN)).toBeCloseTo(166, 6);
  });
});

describe("activity multiplier", () => {
  it("uses the conventional four factors", () => {
    expect(ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
    });
  });

  it("rises monotonically with activity", () => {
    const levels = ["sedentary", "light", "moderate", "active"] as const;
    const values = levels.map((activityLevel) =>
      estimatedMaintenance({ ...WOMAN, activityLevel }),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(4);
  });
});

describe("estimated maintenance", () => {
  it("is BMR × multiplier, rounded to 10 kcal", () => {
    // 1320.25 × 1.2 = 1584.3 → 1580
    expect(estimatedMaintenance(WOMAN)).toBe(1580);
    // 1755 × 1.55 = 2720.25 → 2720
    expect(estimatedMaintenance(MAN)).toBe(2720);
  });

  it("rounds to the nearest 10, not down", () => {
    // BMR 1320.25 × 1.375 = 1815.34 → 1820
    expect(estimatedMaintenance({ ...WOMAN, activityLevel: "light" })).toBe(1820);
  });
});

describe("modes", () => {
  it("offers maintenance, −300 and −700", () => {
    const plan = planFor(MAN);
    expect(plan?.options.map(({ mode, target }) => ({ mode, target }))).toEqual([
      { mode: "maintenance", target: 2720 },
      { mode: "moderate_loss", target: 2420 },
      { mode: "fast_loss", target: 2020 },
    ]);
  });

  it("finds an option by mode", () => {
    const plan = planFor(MAN);
    if (plan === null) throw new Error("expected a plan");
    expect(optionFor(plan, "moderate_loss").target).toBe(2420);
  });
});

describe("the suggestion floor", () => {
  it("is a separate policy from the typo guard in limits.ts", () => {
    expect(SUGGESTED_TARGET_FLOOR.female).toBeGreaterThan(MIN_DAILY_GOAL_CALORIES);
    expect(SUGGESTED_TARGET_FLOOR.male).toBeGreaterThan(MIN_DAILY_GOAL_CALORIES);
  });

  it("is sex-specific, from the top of the NHLBI low-calorie ranges", () => {
    expect(SUGGESTED_TARGET_FLOOR).toEqual({ female: 1200, male: 1600 });
  });

  it("gates a loss mode that would land below it", () => {
    // 1580 − 700 = 880 < 1200
    const plan = planFor(WOMAN);
    if (plan === null) throw new Error("expected a plan");
    expect(optionFor(plan, "fast_loss")).toEqual({
      mode: "fast_loss",
      target: 880,
      belowFloor: true,
      outOfRange: false,
    });
    // 1580 − 300 = 1280 ≥ 1200
    expect(optionFor(plan, "moderate_loss").belowFloor).toBe(false);
  });

  it("does not gate a target exactly at the floor", () => {
    // 10·56.1 + 6.25·160 − 5·30 − 161 = 1250; × 1.2 = 1500; − 300 = 1200.
    const plan = planFor({
      weightKg: 56.1,
      heightCm: 160,
      age: 30,
      sex: "female",
      activityLevel: "sedentary",
    });
    if (plan === null) throw new Error("expected a plan");
    expect(plan.maintenance).toBe(1500);
    expect(optionFor(plan, "moderate_loss")).toMatchObject({ target: 1200, belowFloor: false });
    expect(optionFor(plan, "fast_loss").belowFloor).toBe(true);
  });

  it("never gates maintenance, even when maintenance is under the floor", () => {
    // 10·40 + 6.25·145 − 5·80 − 161 = 745.25; × 1.2 = 894.3 → 890
    const plan = planFor({
      weightKg: 40,
      heightCm: 145,
      age: 80,
      sex: "female",
      activityLevel: "sedentary",
    });
    if (plan === null) throw new Error("expected a plan");
    expect(plan.maintenance).toBe(890);
    expect(optionFor(plan, "maintenance").belowFloor).toBe(false);
    expect(optionFor(plan, "moderate_loss").belowFloor).toBe(true);
    expect(optionFor(plan, "fast_loss").belowFloor).toBe(true);
  });

  it("uses the male floor for men", () => {
    // 10·60 + 6.25·170 − 5·40 + 5 = 1467.5; × 1.2 = 1761 → 1760.
    const plan = planFor({
      weightKg: 60,
      heightCm: 170,
      age: 40,
      sex: "male",
      activityLevel: "sedentary",
    });
    if (plan === null) throw new Error("expected a plan");
    expect(plan.floor).toBe(1600);
    // 1460 would pass the female floor but not the male one.
    expect(optionFor(plan, "moderate_loss")).toMatchObject({ target: 1460, belowFloor: true });
  });
});

describe("invalid input", () => {
  it("returns no plan while any field is out of range", () => {
    expect(planFor({ ...WOMAN, weightKg: 0 })).toBeNull();
    expect(planFor({ ...WOMAN, heightCm: 1650 })).toBeNull();
    expect(planFor({ ...WOMAN, age: 12 })).toBeNull();
    expect(planFor({ ...WOMAN, weightKg: Number.NaN })).toBeNull();
    expect(planFor({ ...WOMAN, age: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("names exactly the fields that are wrong", () => {
    expect(invalidFields({ weightKg: 500, heightCm: 165, age: 5 })).toEqual(["weightKg", "age"]);
    expect(invalidFields(WOMAN)).toEqual([]);
  });

  it("accepts the bounds themselves and rejects just past them", () => {
    const edges = { weightKg: 30, heightCm: 120, age: 19 };
    expect(invalidFields(edges)).toEqual([]);
    expect(invalidFields({ weightKg: 250, heightCm: 230, age: 100 })).toEqual([]);
    expect(invalidFields({ ...edges, weightKg: 29.9 })).toEqual(["weightKg"]);
    expect(invalidFields({ ...edges, heightCm: 230.1 })).toEqual(["heightCm"]);
    expect(invalidFields({ ...edges, age: 18 })).toEqual(["age"]);
  });

  it("never offers a target the goal field would reject", () => {
    // The smallest and largest bodies the form accepts, at both extremes of
    // activity. A suggestion the goal field then refuses is a dead end.
    for (const facts of [
      { weightKg: 30, heightCm: 120, age: 100, sex: "female", activityLevel: "sedentary" },
      { weightKg: 250, heightCm: 230, age: 19, sex: "male", activityLevel: "active" },
    ] as const) {
      const plan = planFor(facts);
      if (plan === null) throw new Error("expected a plan");
      for (const option of plan.options.filter(isAdoptable)) {
        expect(option.target).toBeGreaterThanOrEqual(500);
        expect(option.target).toBeLessThanOrEqual(20_000);
      }
    }
  });

  it("flags, rather than offers, a maintenance under the goal field's minimum", () => {
    // 10·30 + 6.25·120 − 5·100 − 161 = 389; × 1.2 = 466.8 → 470 < 500
    const plan = planFor({
      weightKg: 30,
      heightCm: 120,
      age: 100,
      sex: "female",
      activityLevel: "sedentary",
    });
    if (plan === null) throw new Error("expected a plan");
    expect(optionFor(plan, "maintenance")).toMatchObject({
      target: 470,
      belowFloor: false,
      outOfRange: true,
    });
    expect(isAdoptable(optionFor(plan, "maintenance"))).toBe(false);
  });
});
