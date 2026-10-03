import { describe, expect, it } from "vitest";
import type { Command } from "@/application/commands";
import type { DailySummary } from "@/domain/calories";
import {
  describeAlreadyLogged,
  describeNoneOfThese,
  CANCEL_PENDING,
  NONE_OF_THESE,
  OTHER_FOOD,
  describeCommand,
  describeDeleted,
  describeModified,
  describeRestored,
  UNDO_DELETE,
  objectParticle,
  describeAdded,
  describeNothingAdded,
  describeQuestion,
  describeCancelled,
  describeAddFailure,
  describeUnreadableAmount,
  directionParticle,
} from "./replyText";

function summary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    consumedCalories: 1580,
    calorieTarget: 2100,
    remainingCalories: 520,
    status: "under",
    ...overrides,
  };
}

describe("objectParticle", () => {
  it.each([
    ["갈비탕", "을"],
    ["흰쌀밥", "을"],
    ["삼각김밥", "을"],
    ["두유", "를"],
    ["바나나", "를"],
    ["아메리카노", "를"],
    ["커피", "를"],
  ] as const)("%s → %s", (word, particle) => {
    expect(objectParticle(word)).toBe(particle);
  });

  it("falls back to 를 for a name that is not Hangul", () => {
    expect(objectParticle("ABC")).toBe("를");
    expect(objectParticle("")).toBe("를");
  });
});

describe("status answers are built from domain state, never from the server", () => {
  const answer: Command = { type: "answer", kind: "status" };

  it("reports what is left", () => {
    expect(describeCommand(answer, summary())).toEqual({
      kind: "statement",
      text: "지금까지 1,580 kcal 먹었어요. 520 kcal 남았어요.",
    });
  });

  it("reports hitting the goal exactly", () => {
    const reply = describeCommand(
      answer,
      summary({ consumedCalories: 2100, remainingCalories: 0, status: "exact" }),
    );
    expect(reply).toMatchObject({ text: "지금까지 2,100 kcal 먹었어요. 목표에 딱 맞췄어요." });
  });

  it("never says a negative number", () => {
    const reply = describeCommand(
      answer,
      summary({ consumedCalories: 2240, remainingCalories: -140, status: "over" }),
    );
    expect(reply.text).toBe("지금까지 2,240 kcal 먹었어요. 140 kcal 더 먹었어요.");
    expect(reply.text).not.toContain("-");
  });

  it("asks for a goal before answering without one", () => {
    const reply = describeCommand(
      answer,
      summary({ calorieTarget: null, remainingCalories: null, status: null }),
    );
    expect(reply.text).toBe("목표를 정하면 알려드릴게요.");
  });
});

describe("clarifying questions", () => {
  it("offers the entries to choose between", () => {
    const reply = describeCommand(
      {
        type: "clarify",
        reason: "unknown_target",
        intent: "modify_food",
        candidates: [
          { id: "a", name: "흰쌀밥", amount: "1공기" },
          { id: "b", name: "갈비탕" },
        ],
      },
      summary(),
    );

    expect(reply).toEqual({
      kind: "question",
      text: "어떤 기록을 수정할까요?",
      options: [
        { id: "a", label: "흰쌀밥 1공기" },
        { id: "b", label: "갈비탕" },
        // Always offered: the entry meant may not be among the chips.
        { id: NONE_OF_THESE, label: "해당 없음" },
      ],
    });
  });

  it("says 취소 rather than 수정 for a delete", () => {
    const reply = describeCommand(
      {
        type: "clarify",
        reason: "unknown_target",
        intent: "delete_food",
        candidates: [{ id: "a", name: "갈비탕" }],
      },
      summary(),
    );
    expect(reply.text).toBe("어떤 기록을 취소할까요?");
  });

  it("names the single candidate when confirming, with the right particle", () => {
    const reply = describeCommand(
      {
        type: "clarify",
        reason: "confirm_action",
        intent: "modify_food",
        candidates: [{ id: "a", name: "흰쌀밥" }],
      },
      summary(),
    );
    expect(reply).toMatchObject({
      kind: "question",
      text: "흰쌀밥을 수정할까요?",
    });
  });

  it("does not offer a choice when there is nothing to choose from", () => {
    const reply = describeCommand(
      { type: "clarify", reason: "unknown_target", intent: "delete_food", candidates: [] },
      summary(),
    );
    expect(reply).toEqual({ kind: "statement", text: "아직 오늘 기록이 없어요." });
  });
});

describe("phase 4 boundaries are stated plainly, without dev jargon", () => {
  it.each([
    // Written out in full rather than asserted into shape: these are the
    // commands the screen is expected to route itself, and a cast would stop
    // this test noticing if their shape changed underneath it.
    [
      {
        type: "add_candidate",
        sourceText: "갈비탕 먹었어",
        needsConfirmation: false,
      } satisfies Command,
    ],
    [
      {
        type: "modify_candidate",
        targetId: "a",
        sourceText: "반만",
        needsConfirmation: false,
        parts: [],
      } satisfies Command,
    ],
    [{ type: "delete_candidate", targetId: "a" } satisfies Command],
    [{ type: "answer", kind: "recommendation" } satisfies Command],
  ])("%#", (command) => {
    const reply = describeCommand(command, summary());
    expect(reply.text).not.toMatch(/NutritionResolver|Phase|API|null|undefined/);
    expect(reply.text.length).toBeLessThan(60);
  });

  it("redirects rather than answering food trivia", () => {
    const reply = describeCommand(
      { type: "ignore", reason: "not_consumption" },
      summary(),
    );
    expect(reply).toEqual({
      kind: "statement",
      text: "먹은 걸 말씀해주시면 기록할게요.",
    });
  });
});

describe("the add pipeline's sentences", () => {
  it("reports the stored total, not a number it worked out itself", () => {
    const reply = describeAdded(summary());
    expect(reply.text).toBe("기록했어요. 오늘 1,580 kcal 먹었어요. 520 kcal 남았어요.");
  });

  it("stops after the total when no goal is set", () => {
    const reply = describeAdded(
      summary({ consumedCalories: 362, calorieTarget: null, remainingCalories: null, status: null }),
    );
    expect(reply.text).toBe("기록했어요. 오늘 362 kcal 먹었어요.");
  });

  it("names what it had to leave out", () => {
    const reply = describeAdded(
      summary({ consumedCalories: 362, calorieTarget: null, remainingCalories: null, status: null }),
      ["마라탕"],
    );
    expect(reply.text).toContain("마라탕은 빼고 기록했어요.");
  });

  it("says a representative figure is one, after the totals and without asking", () => {
    const reply = describeAdded(summary(), [], ["치킨"]);
    expect(reply.kind).toBe("statement");
    expect(reply.text).toBe(
      "기록했어요. 오늘 1,580 kcal 먹었어요. 520 kcal 남았어요. " +
        "치킨은 재료와 양에 따라 칼로리 차이가 클 수 있어요. " +
        '다르면 "치킨 800kcal로 고쳐줘"처럼 말해주세요.',
    );
    expect(reply.text).not.toContain("?");
  });

  it("names each varying food once", () => {
    const reply = describeAdded(summary(), [], ["피자", "마라탕", "피자"]);
    expect(reply.text).toContain("피자와 마라탕은 재료와 양에 따라");
  });

  it("shows the correction sentence with one of the foods just recorded", () => {
    expect(describeAdded(summary(), [], ["마라탕"]).text).toContain(
      '다르면 "마라탕 800kcal로 고쳐줘"처럼 말해주세요.',
    );
    expect(describeAdded(summary(), [], ["피자", "마라탕"]).text).toContain(
      '다르면 "피자 800kcal로 고쳐줘"처럼 말해주세요.',
    );
  });

  it("says nothing about variance for an ordinary food", () => {
    expect(describeAdded(summary(), [], []).text).not.toContain("차이가 클 수");
  });

  it("asks for calories, naming the food only when it reads as one", () => {
    const named = describeQuestion({
      type: "provide_calories",
      partIndex: 0,
      label: "마라탕",
      othersResolved: false,
    });
    expect(named.text).toBe(
      "마라탕은 아직 정보가 없어요. 대략 몇 kcal였는지 알려주시면 그대로 적을게요.",
    );

    const unnamed = describeQuestion({
      type: "provide_calories",
      partIndex: 0,
      label: null,
      othersResolved: true,
    });
    expect(unnamed.text).toMatch(/^말씀하신 음식은/);
    expect(unnamed.kind === "question" && unnamed.options[0]?.id).toBe("skip");
  });

  it("says nothing was recorded and that the food must be said again with its figure", () => {
    // No question is waiting after this notice: it must not read as if a
    // number sent next would be taken as the answer.
    const reply = describeNothingAdded([{ status: "unknown", phraseName: "설탕을 넣어서 커피" }]);
    expect(reply.kind).toBe("statement");
    expect(reply.text).toContain("기록하지 않았어요");
    expect(reply.text).toContain("음식 이름과 함께 다시 말씀해주세요");
  });

  it("never glues a particle onto a scrap of sentence", () => {
    const reply = describeNothingAdded([
      { status: "unknown", phraseName: "음... 이건 데이터베이스과 없을거 같고" },
    ]);
    expect(reply.text).toMatch(/^말씀하신 음식은 아직 정보가 없어요/);
  });

  it("never says a food is unknown when it only lacks a portion", () => {
    // The whole reason `unmeasurable` exists as a separate status: one of
    // these the user can fix in a word, the other they cannot fix at all.
    const missingPortion = describeQuestion({
      type: "provide_quantity",
      partIndex: 0,
      phraseName: "커피",
      entries: [{ id: "e1", name: "커피_아메리카노" }],
      reason: "missing_serving",
    });
    const notInDataset = describeNothingAdded([
      { status: "unknown", phraseName: "마라탕" },
    ]);

    expect(missingPortion.text).toContain("찾았어요");
    expect(missingPortion.text).toContain("ml");
    expect(missingPortion.text).not.toContain("정보가 없");

    expect(notInDataset.text).toContain("정보가 없어요");
    expect(notInDataset.text).not.toContain("찾았어요");
  });

  it("asks which food, offering the narrowed candidates", () => {
    const reply = describeQuestion({
      type: "choose_food",
      partIndex: 0,
      mode: "add",
      phraseName: "밥",
      candidates: [
        { entryId: "a", name: "쌀밥" },
        { entryId: "b", name: "현미밥" },
      ],
    });
    expect(reply).toEqual({
      kind: "question",
      text: "어떤 밥인가요?",
      options: [
        { id: "a", label: "쌀밥" },
        { id: "b", label: "현미밥" },
        // The way out of a choice that has not got the food in it.
        { id: OTHER_FOOD, label: "다른 음식이에요" },
        { id: CANCEL_PENDING, label: "취소" },
      ],
    });
  });

  it("keeps the house style — no encouragement, no coaching", () => {
    const texts = [
      describeAdded(summary()).text,
      describeCancelled().text,
      describeAddFailure().text,
      describeUnreadableAmount().text,
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/잘하|훌륭|화이팅|건강한 선택|좋은 선택|파이팅/);
    }
  });
});

describe("correction wording is not borrowed from the add pipeline", () => {
  it("asks what to replace a food with, without naming the correction back", () => {
    const reply = describeQuestion({
      type: "choose_food",
      partIndex: 0,
      mode: "modify",
      phraseName: "아까 갈비탕 아니고 김치찌개 한 그릇 먹었어",
      candidates: [
        { entryId: "a", name: "갈비탕" },
        { entryId: "b", name: "김치찌개" },
      ],
    });
    expect(reply.text).toBe("무엇으로 바꿀까요?");
    if (reply.kind !== "question") throw new Error("expected a question");
    expect(reply.options.map((o) => o.label)).toEqual(["갈비탕", "김치찌개", "다른 음식이에요", "취소"]);
  });

  it("confirms a correction as a correction", () => {
    const reply = describeQuestion({
      type: "confirm_add",
      mode: "modify",
      names: ["밥"],
    });
    expect(reply.text).toBe("밥을 고칠까요?");
  });

  it("backs out of a correction without saying it was not logged", () => {
    expect(describeCancelled("modify").text).toBe("알겠어요. 그대로 둘게요.");
    expect(describeCancelled("add").text).toBe("알겠어요. 기록하지 않을게요.");
  });
});

describe("a counter the food does not publish", () => {
  it("names the counter it could not weigh and the ones it can", () => {
    const reply = describeQuestion({
      type: "provide_quantity",
      partIndex: 0,
      phraseName: "만두",
      entries: [{ id: "e1", name: "고기만두" }],
      reason: "unsupported_unit",
      unit: "개",
      knownUnits: ["인분"],
    });
    expect(reply).toEqual({
      kind: "statement",
      text: "고기만두는 찾았어요. 개 단위 무게는 몰라서, g이나 인분으로 알려주세요.",
    });
  });

  it("falls back to grams alone when no counter is known", () => {
    const reply = describeQuestion({
      type: "provide_quantity",
      partIndex: 0,
      phraseName: "김밥",
      entries: [{ id: "e1", name: "김밥" }],
      reason: "unsupported_unit",
      unit: "개",
    });
    expect(reply.text).toBe("김밥은 찾았어요. 개 단위 무게는 몰라서, g로 알려주세요.");
  });

  it("never claims the food is unknown", () => {
    const reply = describeQuestion({
      type: "provide_quantity",
      partIndex: 0,
      phraseName: "만두",
      entries: [{ id: "e1", name: "고기만두" }],
      reason: "unsupported_unit",
      unit: "개",
      knownUnits: ["인분"],
    });
    expect(reply.text).not.toContain("정보가 없");
  });
});

describe("으로/로", () => {
  it("follows the final consonant, with ㄹ taking 로", () => {
    expect(directionParticle("인분")).toBe("으로");
    expect(directionParticle("그릇")).toBe("으로");
    expect(directionParticle("개")).toBe("로");
    expect(directionParticle("줄")).toBe("로");
    expect(directionParticle("g")).toBe("로");
  });
});

describe("changes to the log say exactly what changed", () => {
  const after = summary({ consumedCalories: 1255, calorieTarget: 2250, remainingCalories: 995, status: "under" });

  it("a correction shows both sides and the calorie change", () => {
    const reply = describeModified(
      { name: "떠먹는 요거트", amount: "200g", calories: 172 },
      { name: "그릭요거트", amount: "200g", calories: 200 },
      after,
    );
    expect(reply.text).toBe(
      "바꿨어요: 떠먹는 요거트 200g → 그릭요거트 200g (172 → 200 kcal). 오늘 1,255 kcal 먹었어요. 995 kcal 남았어요.",
    );
  });

  it("a delete names the amount that went", () => {
    expect(describeDeleted({ name: "바나나", amount: "2개" }, after).text).toMatch(/^바나나 2개를 지웠어요\./);
  });

  it("asks which record when the same food was logged twice", () => {
    const reply = describeCommand(
      {
        type: "clarify",
        reason: "unknown_target",
        intent: "modify_food",
        candidates: [
          { id: "a1", name: "사과", amount: "1개" },
          { id: "a2", name: "사과", amount: "2개" },
        ],
      },
      after,
    );
    expect(reply).toMatchObject({ kind: "question", text: "사과를 두 번 기록했어요. 어느 기록인가요?" });
    if (reply.kind === "question") {
      expect(reply.options.map((option) => option.label)).toEqual(["사과 1개", "사과 2개", "해당 없음"]);
    }
  });

  it("tells same-looking entries apart by the time they were logged", () => {
    const reply = describeCommand(
      {
        type: "clarify",
        reason: "unknown_target",
        intent: "modify_food",
        candidates: [
          { id: "k1", name: "케이크", amount: "1조각", consumedAt: "2026-10-02T03:10:00.000Z" },
          { id: "k2", name: "케이크", amount: "1조각", consumedAt: "2026-10-02T09:45:00.000Z" },
          { id: "c", name: "초콜릿케이크", amount: "1조각", consumedAt: "2026-10-02T10:00:00.000Z" },
        ],
      },
      after,
    );
    if (reply.kind !== "question") throw new Error("expected a question");
    expect(reply.options.map((option) => option.label)).toEqual([
      "케이크 1조각 · 12:10",
      "케이크 1조각 · 18:45",
      "초콜릿케이크 1조각",
      "해당 없음",
    ]);
  });

  it("a confirmed correction names the exact entry and what it becomes", () => {
    const question = {
      type: "confirm_add" as const,
      mode: "modify" as const,
      names: ["케이크"],
      change: {
        target: { name: "케이크", amount: "1조각", consumedAt: "2026-10-02T06:10:00.000Z" },
        replacement: { name: "케이크", amount: "1조각", calories: 700 },
      },
    };
    expect(describeQuestion(question)).toMatchObject({ text: "케이크 1조각(15:10) 기록을 700kcal로 바꿀까요?" });
    expect(
      describeQuestion({
        ...question,
        change: { ...question.change, replacement: { name: "치즈케이크", amount: "1조각", calories: 300 } },
      }),
    ).toMatchObject({ text: "케이크 1조각(15:10) 기록을 치즈케이크 1조각 300kcal로 바꿀까요?" });
  });

  it("'해당 없음' changes nothing and says how to point at the entry", () => {
    expect(describeNoneOfThese("modify_food").text).toContain("아무것도 바꾸지 않았어요");
    expect(describeNoneOfThese("delete_food").text).toContain("아무것도 지우지 않았어요");
  });
});

describe("insisting on what is already stored", () => {
  it("says so, with the right particle", () => {
    expect(describeAlreadyLogged({ name: "바나나", amount: "2개" }).text).toBe("이미 바나나 2개로 기록돼 있어요.");
    expect(describeAlreadyLogged({ name: "김치찌개", amount: "한 그릇" }).text).toBe(
      "이미 김치찌개 한 그릇으로 기록돼 있어요.",
    );
  });
});

describe("a delete can be undone in one tap", () => {
  const after = summary({ consumedCalories: 75, calorieTarget: 2250, remainingCalories: 2175, status: "under" });

  it("offers 되돌리기 with the confirmation", () => {
    expect(describeDeleted({ name: "바나나", amount: "2개" }, after)).toMatchObject({
      kind: "question",
      options: [{ id: UNDO_DELETE, label: "되돌리기" }],
    });
  });

  it("says what came back", () => {
    expect(describeRestored({ name: "바나나", amount: "2개" }, after).text).toMatch(/^바나나 2개를 되돌렸어요\./);
  });
});

describe("part of it was left", () => {
  it("asks for the total eaten, and says why it cannot work it out", () => {
    const reply = describeQuestion({
      type: "provide_quantity",
      partIndex: 0,
      phraseName: "비빔밥",
      entries: [{ id: "e1", name: "비빔밥" }],
      reason: "partly_left",
      knownUnits: ["그릇"],
    });
    expect(reply).toEqual({
      kind: "statement",
      text: "비빔밥은 일부만 남기신 걸 정확히 계산하기 어려워요. 전체로 얼마나 드셨는지 알려주세요. (예: 반 그릇)",
    });
  });
});
