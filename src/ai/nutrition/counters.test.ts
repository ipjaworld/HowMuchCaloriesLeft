import { describe, expect, it } from "vitest";
import { COUNTERS, inferCounter, naturalServingUnit } from "./counters";

describe("countable foods — the case this exists for", () => {
  it.each([
    ["계란", "개"],
    ["달걀", "개"],
    ["메추리알", "개"],
    ["삶은 계란", "개"],
    ["사과", "개"],
    ["바나나", "개"],
    ["고구마", "개"],
    ["만두", "개"],
    ["도넛", "개"],
    ["햄버거", "개"],
  ] as const)("%s is counted in %s", (food, counter) => {
    expect(inferCounter(food)).toBe(counter);
  });
});

describe("bowls, plates and glasses", () => {
  it.each([
    ["갈비탕", "그릇"],
    ["김치찌개", "그릇"],
    ["된장국", "그릇"],
    ["국밥", "그릇"],
    ["전복죽", "그릇"],
    ["라면", "그릇"],
    ["칼국수", "그릇"],
    ["냉면", "그릇"],
    ["흰쌀밥", "공기"],
    ["현미밥", "공기"],
    ["공기밥", "공기"],
    ["비빔밥", "공기"],
    ["아메리카노", "잔"],
    ["카페라떼", "잔"],
    ["오렌지주스", "잔"],
    ["우유", "팩"],
    ["두유", "팩"],
    ["맥주", "병"],
  ] as const)("%s is counted in %s", (food, counter) => {
    expect(inferCounter(food)).toBe(counter);
  });
});

describe("slices, sheets and packets", () => {
  it.each([
    ["피자", "조각"],
    ["치킨", "조각"],
    ["수박", "조각"],
    ["김", "장"],
    ["조미김", "장"],
    ["과자", "봉지"],
    ["젤리", "봉지"],
    ["고등어", "마리"],
  ] as const)("%s is counted in %s", (food, counter) => {
    expect(inferCounter(food)).toBe(counter);
  });
});

describe("specific names beat the generic suffix", () => {
  it("삼각김밥 is 개, not 공기 — it only ends in 밥", () => {
    expect(inferCounter("삼각김밥")).toBe("개");
  });

  it("김밥 is 줄, not 공기", () => {
    expect(inferCounter("김밥")).toBe("줄");
  });

  it("컵라면 is 개, not 그릇 — it comes in a container", () => {
    expect(inferCounter("컵라면")).toBe("개");
  });

  it("주먹밥 is 개", () => {
    expect(inferCounter("주먹밥")).toBe("개");
  });
});

describe("foods with no natural count", () => {
  it.each(["삼겹살", "제육볶음", "김치", "나물무침", "미역"])(
    "%s has none, and that is the answer",
    (food) => {
      // Guessing "1개 of 삼겹살" would be worse than admitting there is no
      // count — the portion is a weight, and the dataset supplies it.
      expect(inferCounter(food)).toBeNull();
    },
  );

  it("falls back to 인분, which is honest rather than wrong", () => {
    expect(naturalServingUnit("삼겹살")).toBe("인분");
    expect(naturalServingUnit("계란")).toBe("개");
  });
});

describe("shape of the result", () => {
  it("only ever returns a counter the quantity parser understands", () => {
    const foods = ["계란", "갈비탕", "흰쌀밥", "아메리카노", "피자", "김", "과자"];
    for (const food of foods) {
      const counter = inferCounter(food);
      expect(counter === null || COUNTERS.includes(counter)).toBe(true);
    }
  });

  it("ignores spacing", () => {
    expect(inferCounter("삶 은 계 란")).toBe("개");
  });

  it("has nothing to say about an empty name", () => {
    expect(inferCounter("")).toBeNull();
    expect(inferCounter("   ")).toBeNull();
  });
});
