import { describe, expect, it } from "vitest";
import { parseFoodPhrases } from "./foodPhrases";

/** Compact view: name plus the parsed amount. */
function parse(sentence: string) {
  return parseFoodPhrases(sentence).map((phrase) => ({
    name: phrase.name,
    value: phrase.quantity.value,
    unit: phrase.quantity.unit,
    assumed: phrase.quantity.assumed,
  }));
}

describe("one food", () => {
  it("reads a name and a count", () => {
    expect(parse("삼각김밥 하나 먹었어")).toEqual([
      { name: "삼각김밥", value: 1, unit: null, assumed: false },
    ]);
  });

  it("assumes one serving when no amount was given", () => {
    expect(parse("아메리카노 마셨어")).toEqual([
      { name: "아메리카노", value: 1, unit: null, assumed: true },
    ]);
  });

  it("keeps a modifier attached to the name", () => {
    expect(parse("삶은 계란 두 개 먹었어")).toEqual([
      { name: "삶은 계란", value: 2, unit: "개", assumed: false },
    ]);
  });

  it("reads a metric amount", () => {
    expect(parse("우유 200ml 마셨어")).toEqual([
      { name: "우유", value: 200, unit: "ml", assumed: false },
    ]);
  });

  it("works with no verb at all", () => {
    expect(parse("메추리알 세개")).toEqual([
      { name: "메추리알", value: 3, unit: "개", assumed: false },
    ]);
  });
});

describe("several foods", () => {
  it("splits on 이랑", () => {
    expect(parse("갈비탕이랑 밥 한 공기 먹음")).toEqual([
      { name: "갈비탕", value: 1, unit: null, assumed: true },
      { name: "밥", value: 1, unit: "공기", assumed: false },
    ]);
  });

  it("splits on 랑 after a count", () => {
    expect(parse("갈비탕 하나랑 밥 한 공기 먹었어")).toEqual([
      { name: "갈비탕", value: 1, unit: null, assumed: false },
      { name: "밥", value: 1, unit: "공기", assumed: false },
    ]);
  });

  it("splits on 에, which links two foods in one meal", () => {
    expect(parse("점심으로 김치찌개에 공기밥 먹었어요")).toEqual([
      { name: "김치찌개", value: 1, unit: null, assumed: true },
      { name: "공기밥", value: 1, unit: null, assumed: true },
    ]);
  });

  it("splits on 하고 and on a comma", () => {
    expect(parse("만두 세 개하고 김치 먹었어")).toHaveLength(2);
    expect(parse("삼각김밥, 두유 먹었어")).toEqual([
      { name: "삼각김밥", value: 1, unit: null, assumed: true },
      { name: "두유", value: 1, unit: null, assumed: true },
    ]);
  });
});

describe("framing words are dropped, not treated as food", () => {
  it.each([
    ["점심에 갈비탕 먹음", "갈비탕"],
    ["저녁에 제육볶음 먹었어", "제육볶음"],
    ["아까 삼각김밥 먹었어", "삼각김밥"],
    ["방금 바나나 한 개 먹었음", "바나나"],
    ["편의점에서 컵라면 하나 먹음", "컵라면"],
  ] as const)("%s → %s", (sentence, name) => {
    expect(parse(sentence)[0]?.name).toBe(name);
  });

  it("drops several stacked markers", () => {
    expect(parse("오늘 점심에 편의점에서 삼각김밥 두 개 먹었어")).toEqual([
      { name: "삼각김밥", value: 2, unit: "개", assumed: false },
    ]);
  });
});

describe("words that only look like conjunctions", () => {
  it("does not split 와인 on 와", () => {
    expect(parse("와인 한잔 마셨어")).toEqual([
      { name: "와인", value: 1, unit: "잔", assumed: false },
    ]);
  });

  it("does not split 과자 on 과", () => {
    expect(parse("과자 한 봉지 먹었어")).toEqual([
      { name: "과자", value: 1, unit: "봉지", assumed: false },
    ]);
  });

  it("does not split 에서 as if it were 에", () => {
    expect(parse("카페에서 라떼 마셨어")).toEqual([
      { name: "라떼", value: 1, unit: null, assumed: true },
    ]);
  });
});

describe("corrections", () => {
  it("reads a half portion", () => {
    expect(parse("밥은 반만")).toEqual([
      { name: "밥은", value: 0.5, unit: null, assumed: false },
    ]);
  });

  it("reads a half serving with a counter", () => {
    expect(parse("밥 반 공기 먹었어")).toEqual([
      { name: "밥", value: 0.5, unit: "공기", assumed: false },
    ]);
  });

  it("keeps the particle on the name for the matcher to sort out", () => {
    // 오이 and 포도 end in what look like particles; stripping here would
    // turn them into 오 and 포. The dataset decides, not this function.
    expect(parse("오이 하나 먹었어")[0]?.name).toBe("오이");
    expect(parse("포도 먹었어")[0]?.name).toBe("포도");
  });
});

describe("nothing to parse", () => {
  it.each(["", "   ", "먹었어"])("%j gives no phrases", (sentence) => {
    expect(parse(sentence)).toEqual([]);
  });
});

describe("the source span is kept for later correction", () => {
  it("records what each phrase came from", () => {
    const phrases = parseFoodPhrases("갈비탕이랑 밥 한 공기 먹음");
    expect(phrases.map((p) => p.sourceText)).toEqual(["갈비탕", "밥 한 공기"]);
  });
});
