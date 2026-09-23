import { describe, expect, it } from "vitest";
import type { Command } from "@/application/commands";
import type { DailySummary } from "@/domain/calories";
import {
  describeCommand,
  objectParticle,
  describeAdded,
  describeNothingAdded,
  describeQuestion,
  describeCancelled,
  describeAddFailure,
  describeUnreadableAmount,
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
    expect(reply.text).toContain("마라탕은 아직 정보가 없어서 빼고 기록했어요.");
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
    expect(reply.options.map((o) => o.label)).toEqual(["갈비탕", "김치찌개"]);
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
