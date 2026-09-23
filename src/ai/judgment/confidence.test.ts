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

/**
 * These pin the operating points chosen from the Phase 4.5 run against
 * `jev-1.13.0` (2026-09-23), using the confidences that run actually
 * produced. They are here so that moving a threshold has to be a decision:
 * a change that breaks one of these is changing a measured trade-off, and
 * the reasoning lives in the comments in `confidence.ts`.
 */
describe("measured operating points (Phase 4.5, jev-1.13.0)", () => {
  it("lets the flagship corrections through without a confirmation tap", () => {
    // "아까 밥 반만 먹었어" 0.87 · "아까 밥은 절반 정도 남겼어" 0.89.
    expect(classifyIntentConfidence("modify_food", 0.87)).toBe("auto");
    expect(classifyIntentConfidence("modify_food", 0.89)).toBe("auto");
  });

  it("still confirms the weakest modify reading", () => {
    // "그 김밥 반만 먹었어" 0.65.
    expect(classifyIntentConfidence("modify_food", 0.65)).toBe("confirm");
  });

  it("confirms every delete the run was not near-certain about", () => {
    // 0 false positives measured, but a wrong delete is the expensive error,
    // so the bar deliberately stayed at 0.95.
    expect(classifyIntentConfidence("delete_food", 0.73)).toBe("confirm");
    expect(classifyIntentConfidence("delete_food", 0.88)).toBe("confirm");
    expect(classifyIntentConfidence("delete_food", 1)).toBe("auto");
  });

  it("separates a vague add from a clear one", () => {
    // "밥 먹었어" 0.49 · "좀 먹었음" 0.81 · "점심에 갈비탕 먹음" 1.00.
    expect(classifyIntentConfidence("add_food", 0.49)).toBe("clarify");
    expect(classifyIntentConfidence("add_food", 0.81)).toBe("confirm");
    expect(classifyIntentConfidence("add_food", 1)).toBe("auto");
  });

  it("asks rather than answering a read-only intent it barely read", () => {
    // "많이 먹었어" came back ask_status at 0.30. Read-only intents have no
    // confirm band, so anything under `auto` clarifies instead of being
    // answered with an irrelevant number.
    expect(classifyIntentConfidence("ask_status", 0.3)).toBe("clarify");
    for (const intent of ["ask_status", "ask_recommendation", "other"] as const) {
      expect(INTENT_THRESHOLDS[intent].confirm).toBe(
        INTENT_THRESHOLDS[intent].auto,
      );
    }
  });

  it("no longer treats a plain report as needing clarification", () => {
    // The reason the threshold moved off 0.5: these are unambiguous.
    // "점심에 갈비탕 먹음" 0.86 is the one that still slips through — the
    // distributions overlap, so some interruption is unavoidable.
    for (const probability of [0.58, 0.65, 0.67, 0.79, 0.84]) {
      expect(isProbable(probability, NOUL_THRESHOLDS.clarificationNeeded)).toBe(
        false,
      );
    }
  });

  it("still asks about the genuinely ambiguous messages", () => {
    // "아까 그거 절반" 0.87 · "라면" 0.89 · "그거 취소" 0.91 · "밥 먹었어" 0.94.
    for (const probability of [0.87, 0.89, 0.91, 0.94]) {
      expect(isProbable(probability, NOUL_THRESHOLDS.clarificationNeeded)).toBe(
        true,
      );
    }
  });

  it("keeps knowledge questions out of the log", () => {
    // "갈비탕 칼로리 높은 편이야?" 0.04 · "제육 먹어도 될까?" 0.05.
    for (const probability of [0.04, 0.05, 0.16, 0.21]) {
      expect(isProbable(probability, NOUL_THRESHOLDS.actualConsumption)).toBe(
        false,
      );
    }
  });
});
