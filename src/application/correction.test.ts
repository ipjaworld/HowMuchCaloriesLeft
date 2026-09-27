import { describe, expect, it } from "vitest";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { itemsOf, resolveAddParts } from "./addFood";
import { correctionFor, splitCorrection, type CorrectionTarget } from "./correction";

const YOGURT: CorrectionTarget = { name: "떠먹는 요거트", amount: "200g", calories: 172 };
const RICE: CorrectionTarget = { name: "쌀밥", amount: "2 공기", calories: 701 };
const APPLE: CorrectionTarget = { name: "사과", amount: "1개", calories: 125 };
const EGG: CorrectionTarget = { name: "삶은 달걀", amount: "1개", calories: 75 };
const STATED: CorrectionTarget = { name: "직접 입력", calories: 700, calorieSource: "user" };

describe("what a correction says the entry should become", () => {
  it.each([
    ["떠먹는 요거트를 그릭 요거트로 바꾸고 싶어", YOGURT, "그릭 요거트 200g"],
    ["떠먹는 요거트 말고 그릭 요거트였어", YOGURT, "그릭 요거트 200g"],
    ["요거트는 그릭요거트였어", YOGURT, "그릭요거트 200g"],
    ["떠먹는 요거트 아니고 그릭요거트 150g", YOGURT, "그릭요거트 150g"],
    ["쌀밥 2공기 말고 1공기", RICE, "쌀밥 1공기"],
    ["쌀밥 한 공기로 바꿔줘", RICE, "쌀밥 한 공기"],
    ["아까 사과 두 개였어", APPLE, "아까 사과 두 개"],
    ["삶은 달걀 두 개였어", EGG, "삶은 달걀 두 개"],
  ])("%s → %s", (message, target, text) => {
    expect(correctionFor(message, target)).toEqual({ kind: "phrase", text });
  });

  it("reads '700 아니고 550' as calories the user states", () => {
    expect(correctionFor("아까 700 아니고 550이야", STATED)).toEqual({ kind: "calories", calories: 550 });
    expect(correctionFor("700칼로리 말고 550", STATED)).toEqual({ kind: "calories", calories: 550 });
  });

  it("reads a lone number as calories only for an entry the user priced", () => {
    expect(correctionFor("550이야", STATED)).toEqual({ kind: "calories", calories: 550 });
    // A dataset entry has grams behind it; "3이야" is left to the amount reader.
    expect(correctionFor("3이야", APPLE)).toEqual({ kind: "phrase", text: "사과 3" });
  });

  it("does not split a food name on a particle-like syllable", () => {
    // 삶은 ends in 은, but 삶 is not the entry.
    expect(splitCorrection("삶은 달걀 두 개였어", "삶은 달걀").previous).toBeNull();
    // 파파야 ends in 야, which is not stripped as a copula.
    expect(splitCorrection("파파야", null).next).toBe("파파야");
  });

  it("trusts 를/는 only when the old side is the entry", () => {
    expect(splitCorrection("우유를 두유로 바꿔줘", "떠먹는 요거트")).toEqual({
      previous: null,
      next: "우유를 두유",
    });
  });
});

describe("the corrected entry is priced by the ordinary lookup", () => {
  it("떠먹는 요거트 200g → 그릭요거트 200g at the Greek yoghurt's own figure", async () => {
    const correction = correctionFor("떠먹는 요거트를 그릭 요거트로 바꾸고 싶어", YOGURT);
    if (correction.kind !== "phrase") throw new Error("expected a phrase");
    const [item] = itemsOf(await resolveAddParts(correction.text, koreanFoodResolver));
    expect(item).toMatchObject({ name: "그릭요거트", amount: "200g" });
    // 100 kcal/100 g, the 품목대표 row.
    expect(item?.calories).toBe(200);
  });

  it("사과 두 개 is re-priced for two, not left at one", async () => {
    const correction = correctionFor("아까 사과 두 개였어", APPLE);
    if (correction.kind !== "phrase") throw new Error("expected a phrase");
    const [item] = itemsOf(await resolveAddParts(correction.text, koreanFoodResolver));
    expect(item?.name).toBe("사과");
    expect(item?.calories).toBe(250);
  });
});

describe("an insisted amount", () => {
  const BANANA: CorrectionTarget = { name: "바나나", amount: "1개", calories: 77 };

  it.each(["2개 먹었다니까?", "2개라니까", "2개 먹었엉"])("%s → 바나나 2개", (message) => {
    expect(correctionFor(message, BANANA)).toEqual({ kind: "phrase", text: "바나나 2개" });
  });
});
