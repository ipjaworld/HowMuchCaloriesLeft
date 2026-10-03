import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RecentItem } from "@/ai/judgment/types";
import { findByName } from "@/ai/nutrition/dataset";
import { KOREAN_FOODS, koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { createLocalDatasetResolver } from "@/ai/nutrition/localDatasetResolver";
import { GENERIC_REPRESENTATIVE_IDS, classifyModifier, nameCarriesMethod } from "@/ai/nutrition/modifierPolicy";
import type { FoodEntry } from "@/ai/nutrition/types";
import { itemsOf, resolveAddParts } from "./addFood";
import { resolveModifyParts } from "./mixedModify";
import { representativeNamesFrom, scoreModifierCases, summarize, type ModifierCase } from "./modifierCoverage";
import { answerCalories, isComplete, nextQuestion, type PendingAdd } from "./pendingAdd";

/**
 * Words in front of a food name (2026-10-03). The fixture's expectations
 * were written before the matcher was changed; `pnpm eval:food-modifiers`
 * prints the same numbers with each case.
 */

const cases = (JSON.parse(readFileSync("fixtures/food-modifier-cases.json", "utf8")) as { cases: ModifierCase[] }).cases;

describe("fixtures/food-modifier-cases.json", () => {
  it("every case reads as expected: no wrong record, no needless question, pairs agree", async () => {
    const scored = await scoreModifierCases(cases, koreanFoodResolver, representativeNamesFrom(KOREAN_FOODS));
    const failed = scored.filter((item) => !item.correct).map((item) => `${item.case.id} ${item.case.input} → ${JSON.stringify(item.outcome)}`);
    expect(failed).toEqual([]);
    expect(summarize(scored)).toMatchObject({ wrongAuto: 0, unnecessary: 0, dropped: 0, inconsistent: 0 });
  });
});

describe("variance says how much a figure varies, never which food it is", () => {
  // The same matching with every `variance` flipped: which food (or none) is
  // read must not move. Only the notice and the estimate flag may.
  const flipped: FoodEntry[] = KOREAN_FOODS.map((entry) =>
    entry.variance === "high" ? { ...entry, variance: undefined } : { ...entry, variance: "high" as const },
  );
  const identity = (search: ReturnType<typeof findByName>) =>
    search.kind === "none" ? "none" : search.kind === "one" ? `one:${search.entry.id}` : `several:${search.entries.map((e) => e.id).sort().join("|")}`;

  it.each(cases.map((item) => item.input.replace(/\s*(먹었어|마셨어)$/, "")))("%s", async (phrase) => {
    const asSaid = await resolveAddParts(`${phrase} 먹었어`, koreanFoodResolver);
    const name = asSaid.at(-1)?.phraseName ?? phrase;
    expect(identity(findByName(flipped, name))).toBe(identity(findByName(KOREAN_FOODS, name)));
  });

  it("a representative is one by its id, not by being marked high", async () => {
    const plain = KOREAN_FOODS.map((entry) => (entry.name === "케이크" ? { ...entry, variance: undefined } : entry));
    const result = await createLocalDatasetResolver(plain).resolve({
      name: "생크림 케이크",
      quantity: { value: 1, unit: null, text: "", assumed: true },
      sourceText: "생크림 케이크",
    });
    expect(result.status === "resolved" && result.match.entry.name).toBe("케이크");
  });
});

describe("the approved representatives", () => {
  it("are all in the dataset", () => {
    const ids = new Set(KOREAN_FOODS.map((entry) => entry.id));
    expect([...GENERIC_REPRESENTATIVE_IDS].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("are not simply every high-variance entry", () => {
    const high = KOREAN_FOODS.filter((entry) => entry.variance === "high");
    expect(GENERIC_REPRESENTATIVE_IDS.size).toBeLessThan(high.length);
    expect(KOREAN_FOODS.filter((entry) => ["마라탕", "계란말이", "고구마튀김"].includes(entry.name)).map((entry) => GENERIC_REPRESENTATIVE_IDS.has(entry.id))).toEqual([false, false, false]);
  });
});

describe("the words the policy knows", () => {
  it.each([
    ["따뜻한", "description"],
    ["편의점", "provenance"],
    ["사준", "provenance"],
    ["사온", "provenance"],
    ["잘", "manner"],
    ["바삭하게", "manner"],
    ["큰", "size"],
    ["구운", "cooking"],
    ["훈제", "cooking"],
    ["넣은", "addition"],
    ["친구가", "argument"],
    ["배고파서", "boundary"],
    ["점심때", "boundary"],
    ["저녁은", "boundary"],
    ["누드", "unresolved"],
  ])("%s → %s", (word, kind) => {
    expect(classifyModifier(word)).toBe(kind);
  });
});

async function pendingFor(sentence: string): Promise<PendingAdd> {
  return {
    sourceText: sentence,
    now: "2026-10-03T12:00:00+09:00",
    parts: await resolveAddParts(sentence, koreanFoodResolver),
    needsConfirmation: false,
  };
}

describe("asking the calories of a described food, and storing the answer", () => {
  it("구운 계란 두 개 → 150 is stored once, under that name and amount", async () => {
    const pending = await pendingFor("구운 계란 두 개 먹었어");
    const question = nextQuestion(pending);
    expect(question).toMatchObject({ type: "provide_calories", label: "구운 계란" });
    if (question?.type !== "provide_calories") throw new Error("expected a calorie question");
    const done = answerCalories(pending, question.partIndex, 150);
    expect(isComplete(done)).toBe(true);
    expect(itemsOf(done.parts)).toEqual([
      { name: "구운 계란", amount: "두 개", calories: 150, caloriesEstimated: false, calorieSource: "user" },
    ]);
  });

  it("the question stores nothing until answered (a 취소 then leaves the day as it was)", async () => {
    const pending = await pendingFor("구운 계란 두 개 먹었어");
    expect(isComplete(pending)).toBe(false);
    expect(itemsOf(pending.parts)).toEqual([]);
  });

  it("beside a known food: only the described one is asked, each keeps its amount", async () => {
    const pending = await pendingFor("구운 계란 두 개랑 바나나 하나 먹었어");
    const question = nextQuestion(pending);
    expect(question).toMatchObject({ type: "provide_calories", label: "구운 계란", othersResolved: true });
    if (question?.type !== "provide_calories") throw new Error("expected a calorie question");
    const items = itemsOf(answerCalories(pending, question.partIndex, 150).parts);
    expect(items.map((item) => `${item.name} ${item.amount} ${item.calories}`)).toEqual(["구운 계란 두 개 150", "바나나 하나 77"]);
  });

  it("a long description keeps its name: 친구가 사준 구운 계란 → 구운 계란", async () => {
    expect(nextQuestion(await pendingFor("친구가 사준 구운 계란 두 개 먹었어"))).toMatchObject({ label: "구운 계란" });
    expect(nextQuestion(await pendingFor("따뜻한 설탕 넣은 커피 마셨어"))).toMatchObject({ label: "따뜻한 설탕 넣은 커피" });
  });
});

describe("a correction reads its food through the same matcher", () => {
  const boiled: RecentItem = { id: "egg", name: "삶은 달걀", amount: "두 개", calories: 150, consumedAt: "2026-10-03T08:00:00+09:00" };

  it("'삶은 달걀 말고 구운 계란 두 개였어' does not re-price the boiled egg", async () => {
    const { parts } = await resolveModifyParts("삶은 달걀 말고 구운 계란 두 개였어", boiled, koreanFoodResolver);
    expect(parts.map((part) => part.status)).toEqual(["unknown"]);
  });

  it("'아메리카노 말고 따뜻한 커피 두 잔이었어' still reaches 아메리카노", async () => {
    const coffee: RecentItem = { id: "c", name: "아메리카노", amount: "1잔", calories: 14, consumedAt: "2026-10-03T08:00:00+09:00" };
    const { parts } = await resolveModifyParts("아메리카노 말고 따뜻한 커피 두 잔이었어", coffee, koreanFoodResolver);
    expect(parts.map((part) => (part.status === "resolved" ? part.item.name : part.status))).toEqual(["아메리카노"]);
  });
});

describe("fixtures/food-modifier-boundary-cases.json — where narration ends and the food begins", () => {
  const boundary = (JSON.parse(readFileSync("fixtures/food-modifier-boundary-cases.json", "utf8")) as { cases: ModifierCase[] }).cases;

  it("an addition, a cooking verb or a stated amount is never dropped as narration", async () => {
    const scored = await scoreModifierCases(boundary, koreanFoodResolver, representativeNamesFrom(KOREAN_FOODS));
    // Cases without a known parser limit read exactly as expected …
    expect(scored.filter((item) => item.case.limit === undefined && !item.correct).map((item) => item.case.id)).toEqual([]);
    // … and the limits behave as recorded: safe, nothing stored as another food.
    expect(scored.filter((item) => item.case.limit !== undefined && !item.correct && !item.withinLimit).map((item) => item.case.id)).toEqual([]);
    expect(summarize(scored)).toMatchObject({ wrongAuto: 0, inconsistent: 0 });
  });
});

describe("verbs that go on keep what they say", () => {
  it.each([
    ["튀겨준", "cooking"],
    ["구워온", "cooking"],
    ["구워서", "cooking"],
    ["삶아서", "cooking"],
    ["넣어서", "addition"],
    ["타서", "addition"],
    ["사준", "provenance"],
    ["가져온", "provenance"],
    ["가서", "boundary"],
  ])("%s → %s", (word, kind) => {
    expect(classifyModifier(word)).toBe(kind);
  });

  it("narration that ends before the food still leaves it alone (택시 타고 와서 김밥)", async () => {
    const parts = await resolveAddParts("택시 타고 와서 김밥 먹었어", koreanFoodResolver);
    expect(parts.at(-1)).toMatchObject({ status: "resolved", item: { name: "김밥" } });
  });
});

describe("a cooking method is carried at the edge of a name's word, not anywhere in it", () => {
  it.each([
    ["삼겹살구이", ["구이", "구운", "군"], true],
    ["군만두", ["구이", "구운", "군"], true],
    ["삶은 달걀", ["삶은"], true],
    ["닭볶음(닭갈비)", ["볶음", "볶은"], true],
    ["두부전", ["부침", "전"], true],
    // 전 in 전골 and 볶음 in 김치볶음밥 are other words that contain the form.
    ["곱창전골", ["부침", "전"], false],
    ["두부전골", ["부침", "전"], false],
    ["김치볶음밥", ["볶음", "볶은"], false],
    ["김치부침개", ["부침", "전"], false],
  ] as const)("%s carries %j: %s", (name, forms, carries) => {
    expect(nameCarriesMethod(name, forms)).toBe(carries);
  });

  it.each([
    ["구운 삼겹살 먹었어", "삼겹살구이"],
    ["구운 만두 먹었어", "군만두"],
    ["부친 두부 먹었어", "두부전"],
    ["튀긴 고구마 먹었어", "고구마튀김"],
  ])("%s → %s, as before the edge rule", async (sentence, name) => {
    const parts = await resolveAddParts(sentence, koreanFoodResolver);
    expect(parts.at(-1)).toMatchObject({ status: "resolved", item: { name } });
  });
});

describe("a figure said with the food keeps the food's name and amount", () => {
  // Local browser, 2026-10-03: "설탕을 넣어서 커피 한 잔 60kcal" was stored as
  // "직접 입력" — the amount made the name fail its check.
  it.each([
    ["설탕을 넣어서 커피 한 잔 60kcal 마셨어", "설탕을 넣어서 커피", "한 잔", 60],
    ["구운 계란 두 개 150kcal 먹었어", "구운 계란", "두 개", 150],
    ["김밥 한 줄 400kcal 먹었어", "김밥", "한 줄", 400],
    ["샌드위치 450kcal 먹었어", "샌드위치", undefined, 450],
  ])("%s → %s %s %i", async (sentence, name, amount, calories) => {
    const parts = await resolveAddParts(sentence, koreanFoodResolver);
    expect(parts).toHaveLength(1);
    const item = parts[0]?.status === "resolved" ? parts[0].item : undefined;
    expect(item).toMatchObject({ name, calories, calorieSource: "user" });
    expect(item?.amount).toBe(amount);
  });
});
