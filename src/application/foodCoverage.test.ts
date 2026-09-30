import { describe, expect, it } from "vitest";
import { KOREAN_FOODS, koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import type { AddPart } from "./addFood";
import {
  evaluateCase,
  COVERAGE_CATEGORIES,
  loadCoverageBaseline,
  loadCoverageCorpus,
  runCoverage,
  summarize,
  toBaseline,
  type CoverageCase,
  type ExpectedFood,
} from "./foodCoverage";

/**
 * The food-input coverage corpus: that it is well formed, that the judge
 * scores results the way it says it does, and that the pipeline still does
 * exactly what the committed baseline says it does.
 *
 * The last one is a freeze, not a target. The baseline records today's
 * failures as failures — 감자탕 priced as 감자 among them — and this test
 * fails on *any* movement, better or worse, so that no change to parsing or
 * matching can shift coverage without a reviewed baseline diff. To accept a
 * change: `FOOD_COVERAGE_UPDATE=1 pnpm eval:food-coverage`.
 */

const cases = loadCoverageCorpus();
const datasetNames = new Set(KOREAN_FOODS.map((entry) => entry.name));
const squash = (text: string) => text.replace(/\s+/g, "");
const spokenForms = new Set(
  KOREAN_FOODS.flatMap((entry) => [entry.name, ...(entry.aliases ?? [])].map(squash)),
);

describe("the corpus is well formed", () => {
  it("names only foods the dataset really has", () => {
    for (const testCase of cases) {
      for (const food of testCase.foods) {
        const named =
          food.status === "ambiguous" ? food.candidates : food.status === "unknown" ? [] : [food.entry];
        for (const name of named) {
          expect(datasetNames.has(name), `${testCase.id}: ${name}`).toBe(true);
        }
      }
      for (const name of testCase.notEaten ?? []) {
        expect(datasetNames.has(name), `${testCase.id}: notEaten ${name}`).toBe(true);
      }
    }
  });

  it("marks unknown only what the dataset has no name or alias for", () => {
    for (const testCase of cases) {
      for (const food of testCase.foods) {
        if (food.status !== "unknown") continue;
        expect(spokenForms.has(squash(food.said)), `${testCase.id}: ${food.said}`).toBe(false);
      }
    }
  });

  it("uses each user's word as it appears in the sentence", () => {
    for (const testCase of cases) {
      for (const food of testCase.foods) {
        expect(squash(testCase.input), testCase.id).toContain(squash(food.said));
      }
    }
  });

  it("covers every category the audit asked for", () => {
    const categories = new Set(cases.map((testCase) => testCase.category));
    expect(categories.size).toBe(COVERAGE_CATEGORIES.length);
  });
});

function testCase(overrides: Partial<CoverageCase>): CoverageCase {
  return {
    id: "t",
    input: "",
    category: "clean",
    why: "unit",
    consumed: true,
    foods: [],
    ...overrides,
  };
}

function resolvedPart(phraseName: string, name: string, amount = "1인분"): AddPart {
  return {
    status: "resolved",
    phraseName,
    item: { name, amount, calories: 100, caloriesEstimated: true },
  };
}

describe("evaluateCase", () => {
  it("counts a compound priced as the food it contains as wrong, not resolved", () => {
    const result = evaluateCase(
      testCase({ foods: [{ said: "감자탕", status: "unknown" }] }),
      [resolvedPart("감자탕", "감자", "1개")],
    );
    expect(result.verdict).toBe("wrong_food");
  });

  it("counts recording a food that was not eaten as a false positive", () => {
    const result = evaluateCase(
      testCase({
        notEaten: ["사과"],
        foods: [{ said: "김밥", status: "resolved", entry: "김밥" }],
      }),
      [resolvedPart("친구한테 사과", "사과", "1개"), resolvedPart("김밥", "김밥", "1줄")],
    );
    expect(result.verdict).toBe("false_positive");
  });

  it("counts a question about a non-food as spurious, not as success", () => {
    const result = evaluateCase(
      testCase({ foods: [{ said: "떡볶이", status: "resolved", entry: "떡볶이" }] }),
      [{ status: "unknown", phraseName: "친구" }, resolvedPart("떡볶이", "떡볶이")],
    );
    expect(result.verdict).toBe("spurious_ask");
  });

  it("checks the amount through the production amount reader", () => {
    const food = { said: "김밥", status: "resolved", entry: "김밥", amount: { value: 0.5, unit: "줄" } } as const;
    expect(evaluateCase(testCase({ foods: [food] }), [resolvedPart("김밥", "김밥", "반 줄")]).verdict)
      .toBe("correct_resolved");
    expect(evaluateCase(testCase({ foods: [food] }), [resolvedPart("김밥", "김밥", "1줄")]).verdict)
      .toBe("wrong_amount");
  });

  it("counts the same food recorded twice as a wrong amount", () => {
    const result = evaluateCase(
      testCase({ foods: [{ said: "떡볶이", status: "resolved", entry: "떡볶이", amount: { value: 0.5 } }] }),
      [resolvedPart("떡볶", "떡볶이", "1인분"), resolvedPart("떡볶이는", "떡볶이", "반만")],
    );
    expect(result.verdict).toBe("wrong_amount");
  });

  it("counts a food dropped beside a handled one as a silent drop, not a pricing", () => {
    const result = evaluateCase(
      testCase({
        foods: [
          { said: "포케", status: "unknown" },
          { said: "아메리카노", status: "resolved", entry: "아메리카노" },
        ],
      }),
      [resolvedPart("포케 먹고 아메리카노", "아메리카노", "1잔")],
    );
    expect(result.verdict).toBe("silent_drop");
    expect(result.foods.map((food) => food.outcome)).toEqual(["dropped", "ok"]);
  });

  it("links a phrase the splitter cut short to the food it was", () => {
    const result = evaluateCase(
      testCase({ foods: [{ said: "떡볶이", status: "resolved", entry: "떡볶이" }] }),
      [resolvedPart("떡볶", "떡볶이")],
    );
    expect(result.verdict).toBe("correct_resolved");
  });

  it("accepts a real ambiguity only when every expected candidate is offered", () => {
    const food: ExpectedFood = { said: "샐러드", status: "ambiguous", candidates: ["닭가슴살 샐러드", "채소 샐러드"] };
    const ambiguous = (names: string[]): AddPart => ({
      status: "ambiguous",
      phraseName: "샐러드",
      candidates: names.map((name) => ({ entryId: name, name, item: { name, calories: 1, caloriesEstimated: true } })),
    });
    expect(evaluateCase(testCase({ foods: [food] }), [ambiguous(["닭가슴살 샐러드", "채소 샐러드"])]).verdict)
      .toBe("correct_ask");
    expect(evaluateCase(testCase({ foods: [food] }), [ambiguous(["닭가슴살 샐러드", "감자"])]).verdict)
      .toBe("wrong_ask");
  });

  it("wants nothing at all for a sentence that reports no eating", () => {
    const quiet = testCase({ consumed: false, notEaten: ["떡볶이"] });
    expect(evaluateCase(quiet, []).verdict).toBe("correct_not_consumed");
    expect(evaluateCase(quiet, [{ status: "unknown", phraseName: "빵 터졌네" }]).verdict).toBe("spurious_ask");
    expect(evaluateCase(quiet, [resolvedPart("떡볶이 먹고 싶다", "떡볶이")]).verdict).toBe("false_positive");
  });
});

describe("the baseline", () => {
  it("is exactly what the production pipeline does today", async () => {
    const runs = await runCoverage(cases, koreanFoodResolver);
    const current = toBaseline(runs.map((run) => run.result));
    const baseline = loadCoverageBaseline();

    expect(
      current,
      "Coverage moved. If intended, run `FOOD_COVERAGE_UPDATE=1 pnpm eval:food-coverage` and review the baseline diff.",
    ).toEqual(baseline);
  });

  it("summarises the same counts the report prints", async () => {
    const runs = await runCoverage(cases, koreanFoodResolver);
    const summary = summarize(runs.map((run) => run.result));
    expect(summary.total + summary.excluded).toBe(cases.length);
    expect(summary.correct + Object.entries(summary.byVerdict)
      .filter(([verdict]) => !verdict.startsWith("correct_"))
      .reduce((sum, [, count]) => sum + count, 0)).toBe(summary.total);
  });
});

describe("silent drops and empty results", () => {
  const eaten = (said: string, entry: string): ExpectedFood => ({ said, status: "resolved", entry });

  it("calls an empty result for a report of eating nothing_found, not silent", () => {
    const result = evaluateCase(testCase({ foods: [eaten("김밥", "김밥")] }), []);
    expect(result.verdict).toBe("nothing_found");
  });

  it("ranks a silent drop with the silent wrongs, above a partial", () => {
    const result = evaluateCase(
      testCase({ foods: [eaten("치킨", "치킨"), eaten("라면", "라면")] }),
      [{ status: "unknown", phraseName: "동생이랑" }, resolvedPart("라면", "라면", "1그릇")],
    );
    expect(result.verdict).toBe("silent_drop");
  });

  it("leaves an excluded category out of every figure", () => {
    const dated = evaluateCase(
      testCase({ category: "unsupported_date", foods: [eaten("떡볶이", "떡볶이")] }),
      [],
    );
    const summary = summarize([dated]);
    expect(summary.total).toBe(0);
    expect(summary.excluded).toBe(1);
  });
});
