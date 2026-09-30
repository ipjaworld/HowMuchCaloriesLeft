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

  it("does not split 사과 on its last syllable", () => {
    // 사 ends in a vowel, so this 과 cannot be the conjunction (that would be
    // 와). It used to split into "사" + "반 개" and price a whole apple.
    expect(parse("사과 반 개 먹었어")).toEqual([
      { name: "사과", value: 0.5, unit: "개", assumed: false },
    ]);
    expect(parse("사과 하나랑 바나나 먹었어").map((p) => p.name)).toEqual(["사과", "바나나"]);
  });

  it("still splits 과 after a final consonant and 와 after a vowel", () => {
    expect(parse("밥과 김치찌개 먹었어").map((p) => p.name)).toEqual(["밥", "김치찌개"]);
    expect(parse("커피와 식빵 먹었어").map((p) => p.name)).toEqual(["커피", "식빵"]);
    expect(parse("사과와 배 먹었어").map((p) => p.name)).toEqual(["사과", "배"]);
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

describe("the eating verb, however it is typed", () => {
  it.each([
    ["바나나 2개 먹었엉", "바나나", 2],
    ["바나나 2개 먹었당", "바나나", 2],
    ["바나나 2개 먹었다니까?", "바나나", 2],
    ["바나나 2개 먹었어요!!", "바나나", 2],
    ["우유 200ml 마셨음ㅋㅋ", "우유", 200],
  ])("%s → %s × %d, never an assumed one", (sentence, name, value) => {
    expect(parse(sentence)).toEqual([expect.objectContaining({ name, value, assumed: false })]);
  });

  it("leaves a food whose name contains the verb alone", () => {
    expect(parse("마시는 요구르트 1개")[0]?.name).toBe("마시는 요구르트");
  });
});

describe("clauses: several verbs in one sentence", () => {
  const names = (sentence: string) => parse(sentence).map((phrase) => phrase.name);

  it("keeps every food an eating verb governs — two foods are not an ambiguity", () => {
    expect(names("라면 먹고 커피 마셨어")).toEqual(["라면", "커피"]);
    expect(names("점심에 비빔밥 먹고 저녁에 라면 먹었어")).toEqual(["비빔밥", "라면"]);
    expect(names("김밥 먹었는데 라면도 먹었어")).toEqual(["김밥", "라면도"]);
  });

  it.each([
    ["라면 안 먹고 김밥 먹었어", ["김밥"]],
    ["짜장면 먹으려고 했는데 짬뽕 먹었어", ["짬뽕"]],
    ["치킨 먹고 싶었는데 샐러드 먹었어", ["샐러드"]],
    ["사과 말고 바나나 먹었어", ["바나나"]],
    ["라면 대신 김밥 먹었어", ["김밥"]],
  ])("leaves out the food a closed marker says was not eaten: %s", (sentence, expected) => {
    expect(names(sentence)).toEqual(expected);
  });

  it.each([
    ["떡볶이 먹으려다 참고 샐러드 먹었어", "떡볶이"],
    ["라면 먹을까 고민 중이야", "라면"],
    ["김밥 먹으려다가 그냥 굶었어", "김밥"],
  ])("never keeps the food before 먹으려다 / 먹을까: %s", (sentence, notEaten) => {
    expect(names(sentence).join(" ")).not.toContain(notEaten);
  });

  it.each(["떡볶이 먹고 싶다", "오늘 아무것도 안 먹었어"])(
    "finds nothing eaten when the eating verb itself says so: %s",
    (sentence) => {
      expect(parse(sentence)).toEqual([]);
    },
  );

  it("leaves a sentence that ends on some other verb to Jev", () => {
    // Whether "빵 터졌네" reports a meal is Jev's consumption judgment. The
    // parser once guessed it from the ending and, guessing wrong, dropped
    // "바나나랑 우유로 아침 해결했어" whole. It no longer guesses.
    expect(names("빵 터졌네")).toEqual(["빵 터졌네"]);
    expect(names("바나나랑 우유로 아침 해결했어")).toContain("바나나");
  });

  it("reads a finished eating verb in mid-sentence as the end of a clause", () => {
    expect(names("김밥 먹었어요 ㅎㅎ 맛있었다")[0]).toBe("김밥");
  });

  it("reads an eating verb typed onto the food", () => {
    expect(names("김밥먹었어")).toEqual(["김밥"]);
    expect(names("떡볶이 시켜먹었어")).toEqual(["떡볶이"]);
  });
});

describe("story around the food is not food", () => {
  const names = (sentence: string) => parse(sentence).map((phrase) => phrase.name);

  it.each([
    ["퇴근하고 떡볶이 먹었어", ["떡볶이"]],
    ["친구랑 김밥 먹었어", ["김밥"]],
    ["김 대리랑 떡볶이 먹었어", ["떡볶이"]],
    ["밤에 라면 먹었어", ["라면"]],
    ["친구한테 사과하고 김밥 먹었어", ["김밥"]],
  ])("drops framing only by the separator after it: %s", (sentence, expected) => {
    expect(names(sentence)).toEqual(expected);
  });

  it.each([
    ["오늘 퇴근하고 기분이 안좋아져서 떡볶이를 먹었어", "기분이 안좋아져서 떡볶이를"],
    ["회의 끝나고 밥 먹었어", "회의 끝나고 밥"],
    ["편의점 가서 바나나 사 먹었어", "편의점 가서 바나나"],
  ])("leaves story in place for the matcher, never cutting it away: %s", (sentence, phrase) => {
    // The matcher takes a food only where it ends the phrase; what it cannot
    // place is asked about. Cutting "everything before the last connective"
    // once cut eaten foods with it — "치킨 배달시켜서 동생이랑 먹었어".
    expect(names(sentence)).toEqual([phrase]);
  });

  it("decides by the pair, so a food that is also a word is kept", () => {
    // 밤 before 에 is a time; before 이랑 it is a chestnut.
    expect(names("밤이랑 고구마 먹었어")).toEqual(["밤", "고구마"]);
    // An unknown food before 이랑 is still a food, not company.
    expect(names("마라탕이랑 떡볶이 먹었어")).toEqual(["마라탕", "떡볶이"]);
    // 망고 ends in 고 like a verb does, and is still a food.
    expect(names("망고 먹었어")).toEqual(["망고"]);
  });
});

describe("an amount corrected in the same sentence", () => {
  it("takes the amount a later clause gives the one food before it", () => {
    expect(parse("김밥 한 줄 먹었는데 반 줄만 먹은 거였어")).toEqual([
      { name: "김밥", value: 0.5, unit: "줄", assumed: false },
    ]);
  });

  it("subtracts what was left", () => {
    expect(parse("라면 먹었는데 반은 남겼어")).toEqual([
      { name: "라면", value: 0.5, unit: null, assumed: false },
    ]);
  });

  it("reads past 만 on an amount", () => {
    expect(parse("갈비탕 반 그릇만 먹었어")).toEqual([
      { name: "갈비탕", value: 0.5, unit: "그릇", assumed: false },
    ]);
  });
});

describe("a stated total keeps the single-clause reading", () => {
  it("does not cut 합쳐서 away from the foods it totals", () => {
    expect(parseFoodPhrases("김치찌개랑 밥 합쳐서 800칼로리").map((p) => p.name)[0]).toBe("김치찌개");
  });
});
