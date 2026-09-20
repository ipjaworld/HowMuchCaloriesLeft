import { describe, expect, it } from "vitest";
import type { Command } from "@/application/commands";
import type { DailySummary } from "@/domain/calories";
import { describeCommand, describeResolvedTarget, objectParticle } from "./replyText";

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

  it("asks for the food when the sentence named none", () => {
    const reply = describeCommand(
      { type: "clarify", reason: "unclear_food", intent: "add_food" },
      summary(),
    );
    expect(reply).toEqual({
      kind: "statement",
      text: "무엇을 얼마나 드셨는지 알려주세요.",
    });
  });
});

describe("phase 4 boundaries are stated plainly, without dev jargon", () => {
  it.each([
    [{ type: "add_candidate", sourceText: "갈비탕 먹었어" } as Command],
    [{ type: "modify_candidate", targetId: "a", sourceText: "반만" } as Command],
    [{ type: "delete_candidate", targetId: "a" } as Command],
    [{ type: "answer", kind: "recommendation" } as Command],
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

describe("describeResolvedTarget", () => {
  it("uses the right verb and particle", () => {
    expect(describeResolvedTarget("delete_food", "갈비탕")).toBe(
      "갈비탕을 찾았어요. 삭제는 다음 단계에서 연결할게요.",
    );
    expect(describeResolvedTarget("modify_food", "두유")).toBe(
      "두유를 찾았어요. 수정은 다음 단계에서 연결할게요.",
    );
  });
});
