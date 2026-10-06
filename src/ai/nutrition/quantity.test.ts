import { describe, expect, it } from "vitest";
import {
  assumedQuantity,
  normalizeSpacing,
  parseTrailingQuantity,
  parseAmountOnly,
  readAmountAnswer,
} from "./quantity";

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

  it("does not read the 반 that ends a name (햇반, 콩자반)", () => {
    expect(parseTrailingQuantity("햇반")).toBeNull();
    expect(parseTrailingQuantity("콩자반")).toBeNull();
    expect(parse("햇반 반")).toMatchObject({ value: 0.5, unit: null });
  });

  it("reads 반만, which is how a correction is usually phrased", () => {
    expect(parse("밥은 반만")).toMatchObject({ value: 0.5, unit: null });
  });

  it("adds a trailing 반 to a whole count", () => {
    expect(parse("갈비탕 한 그릇 반")).toMatchObject({ value: 1.5, unit: "그릇" });
    expect(parse("밥 두 공기 반")).toMatchObject({ value: 2.5, unit: "공기" });
  });
});

describe("written fractions — 1/2 is half, never 2 (2026-10-06 feedback)", () => {
  it.each([
    ["햇반 1/2", 0.5, null, "1/2"],
    ["바나나 1/2개", 0.5, "개", "1/2개"],
    ["밥 1/2공기", 0.5, "공기", "1/2공기"],
    ["밥 1/2 공기", 0.5, "공기", "1/2 공기"],
    ["피자 1 / 4 조각", 0.25, "조각", "1 / 4 조각"],
    ["김밥 2/3줄", 2 / 3, "줄", "2/3줄"],
    ["라면 1/3", 1 / 3, null, "1/3"],
    ["햇반1/2", 0.5, null, "1/2"],
    ["밥 2분의 1 공기", 0.5, "공기", "2분의 1 공기"],
    ["밥 3분의1", 1 / 3, null, "3분의1"],
    ["밥 1/2공기만", 0.5, "공기", "1/2공기"],
  ] as const)("%s → %s %s", (phrase, value, unit, text) => {
    const match = parseTrailingQuantity(phrase);
    expect(match?.quantity).toEqual({ value, unit, text, assumed: false });
  });

  it("leaves the food name whole", () => {
    expect(parseTrailingQuantity("바나나 1/2개")?.start).toBe("바나나 ".length);
    expect(parseTrailingQuantity("햇반1/2")?.start).toBe("햇반".length);
  });

  it.each(["김밥 10/3", "김밥 11/2", "김밥 3/2개", "김밥 0/2", "김밥 1/20", "김밥 1/0개"])(
    "%s is not an amount, and its last digit is not one either",
    (phrase) => {
      expect(parseTrailingQuantity(phrase)).toBeNull();
    },
  );

  it("still reads the whole and decimal digits it always did", () => {
    expect(parse("밥 1.5공기")).toMatchObject({ value: 1.5, unit: "공기" });
    expect(parse("만두 12")).toMatchObject({ value: 12, unit: null });
  });

  it.each([
    ["1/2", 0.5, null],
    ["1/2개", 0.5, "개"],
    ["2분의 1", 0.5, null],
  ] as const)("answers the amount question: %s", (text, value, unit) => {
    expect(parseAmountOnly(text)).toMatchObject({ value, unit });
    expect(readAmountAnswer(`${text}이요`)).toMatchObject({ value, unit });
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

describe("parseAmountOnly — answering 'how much of it?'", () => {
  it.each([
    ["200ml", 200, "ml"],
    ["210g", 210, "g"],
    ["100 g", 100, "g"],
    ["한 공기", 1, "공기"],
  ] as const)("reads %s", (text, value, unit) => {
    const quantity = parseAmountOnly(text);
    expect(quantity?.value).toBe(value);
    expect(quantity?.unit).toBe(unit);
  });

  it("refuses an answer that still carries a food name", () => {
    // That is a new sentence, not an answer to the open question.
    expect(parseAmountOnly("커피 200ml")).toBeNull();
  });

  it("refuses text with no amount in it at all", () => {
    expect(parseAmountOnly("몰라")).toBeNull();
    expect(parseAmountOnly("")).toBeNull();
  });

  it("still lets parseTrailingQuantity refuse a bare amount", () => {
    // The two functions disagree on purpose: inside a sentence a bare
    // quantity is the food being named, not its amount.
    expect(parseTrailingQuantity("200ml")).toBeNull();
  });
});

describe("readAmountAnswer — the reply to the quantity question", () => {
  it.each([
    ["200ml", 200, "ml"],
    ["반 그릇", 0.5, "그릇"],
    ["반 그릇이요", 0.5, "그릇"],
    ["두 개요.", 2, "개"],
    ["200ml 정도요", 200, "ml"],
    ["반 정도", 0.5, null],
    ["하나요", 1, null],
  ] as const)("reads %s", (text, value, unit) => {
    const quantity = readAmountAnswer(text);
    expect(quantity?.value).toBe(value);
    expect(quantity?.unit).toBe(unit);
  });

  it.each(["김밥 먹었어", "라면 반", "커피 200ml", "몰라", "요", ""])(
    "returns null for %s, which the caller reads as a new sentence",
    (text) => {
      expect(readAmountAnswer(text)).toBeNull();
    },
  );
});
