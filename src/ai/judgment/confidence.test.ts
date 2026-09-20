import { describe, expect, it } from "vitest";
import {
  INTENT_THRESHOLDS,
  NOUL_THRESHOLDS,
  classifyConfidence,
  classifyIntentConfidence,
  isProbable,
} from "./confidence";
import { INTENTS } from "./types";

describe("classifyConfidence", () => {
  const thresholds = { auto: 0.9, confirm: 0.5 };

  it.each([
    [1, "auto"],
    [0.9, "auto"],
    [0.89, "confirm"],
    [0.5, "confirm"],
    [0.49, "clarify"],
    [0, "clarify"],
  ] as const)("%s → %s", (confidence, expected) => {
    expect(classifyConfidence(confidence, thresholds)).toBe(expected);
  });
});

describe("intent thresholds are risk-weighted", () => {
  it("covers every intent", () => {
    for (const intent of INTENTS) {
      expect(INTENT_THRESHOLDS[intent]).toBeDefined();
    }
  });

  it("asks for more certainty to write than to read", () => {
    expect(INTENT_THRESHOLDS.add_food.auto).toBeGreaterThan(
      INTENT_THRESHOLDS.ask_status.auto,
    );
  });

  it("asks for the most certainty to delete", () => {
    const deleting = INTENT_THRESHOLDS.delete_food.auto;
    expect(deleting).toBeGreaterThan(INTENT_THRESHOLDS.add_food.auto);
    expect(deleting).toBeGreaterThan(INTENT_THRESHOLDS.modify_food.auto);
  });

  it("never puts confirm above auto", () => {
    for (const intent of INTENTS) {
      const { auto, confirm } = INTENT_THRESHOLDS[intent];
      expect(confirm).toBeLessThanOrEqual(auto);
    }
  });

  it("acts on a weak reading for a read-only intent but not a destructive one", () => {
    expect(classifyIntentConfidence("ask_status", 0.6)).toBe("auto");
    expect(classifyIntentConfidence("delete_food", 0.6)).toBe("clarify");
  });

  it("lands the same confidence in different buckets per intent", () => {
    expect(classifyIntentConfidence("ask_status", 0.92)).toBe("auto");
    expect(classifyIntentConfidence("add_food", 0.92)).toBe("auto");
    expect(classifyIntentConfidence("delete_food", 0.92)).toBe("confirm");
  });
});

describe("noul probabilities are handled separately from choice confidence", () => {
  it("is a plain threshold test, not a three-way split", () => {
    expect(isProbable(0.51, NOUL_THRESHOLDS.actualConsumption)).toBe(true);
    expect(isProbable(0.49, NOUL_THRESHOLDS.actualConsumption)).toBe(false);
    expect(isProbable(0.5, NOUL_THRESHOLDS.actualConsumption)).toBe(true);
  });

  it("keeps both noul thresholds inside the probability range", () => {
    for (const threshold of Object.values(NOUL_THRESHOLDS)) {
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThan(1);
    }
  });
});
