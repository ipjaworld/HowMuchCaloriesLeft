import { describe, expect, it } from "vitest";
import { assumedQuantity, normalizeSpacing, parseTrailingQuantity } from "./quantity";

function parse(phrase: string) {
  return parseTrailingQuantity(phrase)?.quantity ?? null;
}

describe("native numerals with a counter", () => {
  it.each([
    ["밥 한 공기", 1, "공기"],
    ["밥 두 공기", 2, "공기"],
    ["계란 세 개", 3, "개"],
    ["계란 네 개", 4, "개"],
    ["메추리알 다섯 개", 5, "개"],
    ["치킨 두 조각", 2, "조각"],
    ["김 열 장", 10, "장"],
  ] as const)("%s → %s %s", (phrase, value, unit) => {
    expect(parse(phrase)).toMatchObject({ value, unit, assumed: false });
  });

  it("reads a counter written without a space", () => {
    expect(parse("메추리알 세개")).toMatchObject({ value: 3, unit: "개" });
    expect(parse("아아 한잔")).toMatchObject({ value: 1, unit: "잔" });
  });
});

describe("standalone native numerals", () => {
  it.each([
    ["삼각김밥 하나", 1],
    ["삼각김밥 둘", 2],
    ["만두 셋", 3],
  ] as const)("%s → %s with no counter", (phrase, value) => {
    expect(parse(phrase)).toMatchObject({ value, unit: null });
  });
});

describe("digits", () => {
  it.each([
    ["우유 200ml", 200, "ml"],
    ["닭가슴살 100g", 100, "g"],
    ["삼각김밥 2개", 2, "개"],
    ["밥 1.5공기", 1.5, "공기"],
  ] as const)("%s → %s %s", (phrase, value, unit) => {
    expect(parse(phrase)).toMatchObject({ value, unit });
  });

  it("reads a bare digit as a count", () => {
    expect(parse("만두 3")).toMatchObject({ value: 3, unit: null });
  });
});

describe("fractions — people leave food, so these matter", () => {
  it.each([
    ["밥 반 공기", 0.5, "공기"],
    ["갈비탕 절반 그릇", 0.5, "그릇"],
  ] as const)("%s → %s %s", (phrase, value, unit) => {
    expect(parse(phrase)).toMatchObject({ value, unit });
  });

  it("reads a bare 반", () => {
    expect(parse("밥은 반")).toMatchObject({ value: 0.5, unit: null });
  });

  it("reads 반만, which is how a correction is usually phrased", () => {
    expect(parse("밥은 반만")).toMatchObject({ value: 0.5, unit: null });
  });

  it("adds a trailing 반 to a whole count", () => {
    expect(parse("갈비탕 한 그릇 반")).toMatchObject({ value: 1.5, unit: "그릇" });
    expect(parse("밥 두 공기 반")).toMatchObject({ value: 2.5, unit: "공기" });
  });
});

describe("no quantity", () => {
  it.each(["아메리카노", "갈비탕", "김치찌개"])("%s has none", (phrase) => {
    expect(parseTrailingQuantity(phrase)).toBeNull();
  });

  it("does not treat the whole phrase as a quantity", () => {
    // Otherwise "하나" alone would parse as a count with no food left.
    expect(parseTrailingQuantity("하나")).toBeNull();
    expect(parseTrailingQuantity("반")).toBeNull();
  });

  it("offers one serving as the assumption, flagged as such", () => {
    expect(assumedQuantity()).toEqual({
      value: 1,
      unit: null,
      text: "",
      assumed: true,
    });
  });
});

describe("keeps what the user wrote for display", () => {
  it.each([
    ["밥 한 공기", "한 공기"],
    ["우유 200ml", "200ml"],
    ["밥 반 공기", "반 공기"],
    ["삼각김밥 하나", "하나"],
  ] as const)("%s keeps %j", (phrase, text) => {
    expect(parse(phrase)?.text).toBe(text);
  });
});

describe("normalizeSpacing", () => {
  it("collapses whatever the keyboard produced", () => {
    expect(normalizeSpacing("밥  한   공기 ")).toBe("밥 한 공기");
  });

  it("survives a phrase that is only whitespace", () => {
    expect(normalizeSpacing("   ")).toBe("");
  });
});

describe("a food name is never eaten by the unit pattern", () => {
  it("does not read 공기밥 as a 공기 of something", () => {
    // No numeral precedes it, so there is nothing to match.
    expect(parseTrailingQuantity("공기밥")).toBeNull();
  });

  it("does not read 만두 as 만 + 두", () => {
    expect(parseTrailingQuantity("만두")).toBeNull();
  });
});
