import { describe, expect, it } from "vitest";
import { asksToChangeGoal } from "@/application/commands";
import { loadLocalRouterEval } from "./evalSet";

/**
 * The eval set is data the report depends on, so it is held to the same
 * standard as the golden set: it must parse, and its goal cases must be ones
 * the code rule really catches — otherwise the report would credit or blame a
 * judge for sentences no judge decides.
 */

const data = loadLocalRouterEval();

describe("evals/local-router.json", () => {
  it("parses, with enough cases to be worth running", () => {
    expect(data.cases.length).toBeGreaterThanOrEqual(50);
  });

  it("covers every input the task asked for", () => {
    const inputs = data.cases.map((c) => c.input);
    for (const required of [
      "아침에 계란 두 개 먹었어",
      "점심 김치찌개랑 밥",
      "아까 먹은 바나나 취소해줘",
      "오늘 목표 1800으로 바꿔줘",
      "나 오늘 얼마나 더 먹어도 돼?",
      "배고프다",
      "오늘 운동했는데 더 먹어도 돼?",
    ]) {
      expect(inputs).toContain(required);
    }
    const tags = new Set(data.cases.flatMap((c) => c.tags));
    for (const tag of ["typo", "abbreviation", "no_particle", "number", "multi_food", "ambiguous"]) {
      expect(tags).toContain(tag);
    }
  });

  it("marks as goal_setting exactly the sentences the goal rule catches", () => {
    for (const testCase of data.cases) {
      expect(
        asksToChangeGoal(testCase.input),
        `${testCase.id}: "${testCase.input}"`,
      ).toBe(testCase.expectedIntent === "goal_setting");
    }
  });
});
