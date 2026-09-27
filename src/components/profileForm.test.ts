import { describe, expect, it } from "vitest";
import { adoptCalculatedGoal } from "@/application/calculatedGoal";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageDietProfileRepository } from "@/infrastructure/localStorageDietProfileRepository";
import { STORAGE_KEYS, createMemoryStorage, readJson } from "@/infrastructure/storage";
import {
  FIELD_LABELS,
  PROFILE_FIELD_ORDER,
  cleanFieldInput,
  draftFrom,
  factsFrom,
  type Draft,
} from "./profileForm";

describe("field order", () => {
  it("asks for height first, then weight, then age", () => {
    expect(PROFILE_FIELD_ORDER).toEqual(["heightCm", "weightKg", "age"]);
    expect(PROFILE_FIELD_ORDER.map((field) => FIELD_LABELS[field].label)).toEqual([
      "키",
      "몸무게",
      "나이",
    ]);
  });

  it("each label sits with its own unit", () => {
    expect(FIELD_LABELS.heightCm).toEqual({ label: "키", unit: "cm" });
    expect(FIELD_LABELS.weightKg).toEqual({ label: "몸무게", unit: "kg" });
    expect(FIELD_LABELS.age).toEqual({ label: "나이", unit: "세" });
  });
});

describe("typed values reach the right fact", () => {
  const typed: Draft = {
    heightCm: "184",
    weightKg: "92",
    age: "34",
    sex: "male",
    activityLevel: "light",
    goalMode: "moderate_loss",
  };

  it("184 in 키 and 92 in 몸무게 stay 184 cm and 92 kg", () => {
    expect(factsFrom(typed)).toMatchObject({ heightCm: 184, weightKg: 92, age: 34 });
  });

  it("and are stored that way, not swapped", async () => {
    const storage = createMemoryStorage();
    const facts = factsFrom(typed);
    if (facts === null) throw new Error("facts should be complete");

    const result = await adoptCalculatedGoal(
      {
        goals: createLocalStorageDailyGoalRepository({ storage }),
        profile: createLocalStorageDietProfileRepository({ storage }),
      },
      { date: "2026-09-27", facts, goalMode: "moderate_loss", now: new Date("2026-09-27T12:00:00+09:00") },
    );
    expect(result.ok).toBe(true);

    const stored = JSON.stringify(readJson(storage, STORAGE_KEYS.dietProfile));
    expect(stored).toContain('"heightCm":184');
    expect(stored).toContain('"weightKg":92');
  });

  it("a saved profile reopens into the same fields", () => {
    const draft = draftFrom({
      heightCm: 184,
      weightKg: 92,
      age: 34,
      sex: "male",
      activityLevel: "light",
      goalMode: "moderate_loss",
      updatedAt: "2026-09-27T03:00:00.000Z",
    });
    expect(draft.heightCm).toBe("184");
    expect(draft.weightKg).toBe("92");
  });

  it("keeps a decimal only for weight", () => {
    expect(cleanFieldInput("weightKg", "72.5kg")).toBe("72.5");
    expect(cleanFieldInput("heightCm", "175.5")).toBe("1755");
    expect(cleanFieldInput("age", "34세")).toBe("34");
  });
});
