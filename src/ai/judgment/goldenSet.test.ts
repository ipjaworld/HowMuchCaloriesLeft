import { describe, expect, it } from "vitest";
import { GOLDEN_CATEGORIES, contextFor, loadGoldenSet } from "./goldenSet";

/**
 * Promotes the Phase 1 one-off check into a real test. This does not measure
 * Jev — it guarantees the fixture stays well-formed so that the accuracy run
 * in Phase 4 has something trustworthy to measure against.
 */
describe("Korean golden set fixture", () => {
  const goldenSet = loadGoldenSet();

  it("parses against the schema", () => {
    expect(goldenSet.version).toBe(1);
    expect(goldenSet.contexts.length).toBeGreaterThan(0);
    expect(goldenSet.cases.length).toBeGreaterThanOrEqual(50);
  });

  it("has unique case ids", () => {
    const ids = goldenSet.cases.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique context ids", () => {
    const ids = goldenSet.contexts.map((context) => context.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every category", () => {
    const used = new Set(goldenSet.cases.map((testCase) => testCase.category));
    expect([...GOLDEN_CATEGORIES].filter((c) => !used.has(c))).toEqual([]);
  });

  it("resolves every case's context", () => {
    for (const testCase of goldenSet.cases) {
      expect(() => contextFor(goldenSet, testCase)).not.toThrow();
    }
  });

  it("points every reference target at an item that exists in its context", () => {
    for (const testCase of goldenSet.cases) {
      const targetId = testCase.expected.referenceTargetId;
      if (targetId === null) continue;

      const context = contextFor(goldenSet, testCase);
      expect(
        context.recentItems.map((item) => item.id),
        `case ${testCase.id}`,
      ).toContain(targetId);
    }
  });

  it("never expects a reference target for an intent that cannot use one", () => {
    const cannotReference = new Set([
      "add_food",
      "ask_status",
      "ask_recommendation",
      "other",
    ]);

    for (const testCase of goldenSet.cases) {
      if (cannotReference.has(testCase.expected.intent)) {
        expect(
          testCase.expected.referenceTargetId,
          `case ${testCase.id}`,
        ).toBeNull();
      }
    }
  });

  it("never marks a question or a cancellation as actual consumption", () => {
    const notConsumption = goldenSet.cases.filter((testCase) =>
      ["question", "recommendation", "not_consumption", "delete"].includes(
        testCase.category,
      ),
    );

    expect(notConsumption.length).toBeGreaterThan(0);
    for (const testCase of notConsumption) {
      expect(
        testCase.expected.isActualConsumption,
        `case ${testCase.id}`,
      ).toBe(false);
    }
  });

  it("requires clarification on every ambiguous case", () => {
    const ambiguous = goldenSet.cases.filter(
      (testCase) => testCase.category === "ambiguous",
    );

    expect(ambiguous.length).toBeGreaterThan(0);
    for (const testCase of ambiguous) {
      expect(
        testCase.expected.needsClarification,
        `case ${testCase.id}`,
      ).toBe(true);
    }
  });

  it("never leaves an undecided target paired with a confident action", () => {
    for (const testCase of goldenSet.cases) {
      const { intent, referenceTargetId, needsClarification } = testCase.expected;
      const referencing = intent === "modify_food" || intent === "delete_food";

      if (referencing && referenceTargetId === null) {
        expect(needsClarification, `case ${testCase.id}`).toBe(true);
      }
    }
  });

  it("gives each context a fixed 'now' so time-relative cases do not drift", () => {
    for (const context of goldenSet.contexts) {
      expect(Number.isNaN(new Date(context.now).getTime())).toBe(false);
    }
  });
});
