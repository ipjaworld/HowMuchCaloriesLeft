import { describe, expect, it } from "vitest";
import type { Judgment, JudgmentInput, RecentItem } from "@/ai/judgment/types";
import { decideCommand } from "./commands";

const RECENT: RecentItem[] = [
  {
    id: "i-galbitang",
    name: "갈비탕",
    calories: 650,
    mealType: "lunch",
    consumedAt: "2026-09-20T12:40:00+09:00",
  },
  {
    id: "i-rice",
    name: "흰쌀밥",
    amount: "1공기",
    calories: 320,
    mealType: "lunch",
    consumedAt: "2026-09-20T12:41:00+09:00",
  },
];

function input(message = "아까 밥 반만 먹었어"): JudgmentInput {
  return {
    message,
    now: "2026-09-20T13:20:00+09:00",
    dailyGoalCalories: 2100,
    recentItems: RECENT,
  };
}

/** A confident, unambiguous judgment; each test overrides what it cares about. */
function judgment(overrides: Partial<Judgment> = {}): Judgment {
  return {
    intent: "add_food",
    intentConfidence: 0.99,
    actualConsumptionProbability: 0.95,
    clarificationProbability: 0.05,
    referenceTargetId: null,
    referenceConfidence: null,
    source: "mock",
    ...overrides,
  };
}

describe("decideCommand", () => {
  describe("reading the log", () => {
    it("answers a status question", () => {
      expect(
        decideCommand(judgment({ intent: "ask_status" }), input("오늘 얼마나 남았어?")),
      ).toEqual({ type: "answer", kind: "status" });
    });

    it("answers a status question on a weak reading — it changes nothing", () => {
      const command = decideCommand(
        judgment({ intent: "ask_status", intentConfidence: 0.55 }),
        input("오늘 얼마나 남았어?"),
      );
      expect(command).toEqual({ type: "answer", kind: "status" });
    });

    it("routes a recommendation", () => {
      expect(
        decideCommand(
          judgment({ intent: "ask_recommendation" }),
          input("저녁 뭐 먹지?"),
        ),
      ).toEqual({ type: "answer", kind: "recommendation" });
    });
  });

  describe("adding", () => {
    it("proposes a candidate, not a finished record", () => {
      const command = decideCommand(judgment(), input("삼각김밥 하나 먹었어"));
      expect(command).toEqual({
        type: "add_candidate",
        sourceText: "삼각김밥 하나 먹었어",
      });
    });

    it("refuses to log a question about a food", () => {
      const command = decideCommand(
        judgment({ actualConsumptionProbability: 0.1 }),
        input("갈비탕 칼로리 높은 편이야?"),
      );
      expect(command).toEqual({ type: "ignore", reason: "not_consumption" });
    });

    it("asks when the food or the amount is unclear", () => {
      const command = decideCommand(
        judgment({ clarificationProbability: 0.9 }),
        input("밥 먹었어"),
      );
      expect(command).toMatchObject({ type: "clarify", reason: "unclear_food" });
    });

    it("asks for confirmation on a middling reading", () => {
      const command = decideCommand(
        judgment({ intentConfidence: 0.6 }),
        input("라면"),
      );
      expect(command).toMatchObject({
        type: "clarify",
        reason: "confirm_action",
        intent: "add_food",
      });
    });

    it("checks consumption before confidence — a question is never logged", () => {
      const command = decideCommand(
        judgment({ intentConfidence: 0.99, actualConsumptionProbability: 0.2 }),
        input("삼각김밥 몇칼로리야?"),
      );
      expect(command).toEqual({ type: "ignore", reason: "not_consumption" });
    });
  });

  describe("modifying and deleting", () => {
    it("proposes a modify candidate when the target is settled", () => {
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          referenceTargetId: "i-rice",
          referenceConfidence: 0.9,
        }),
        input(),
      );
      expect(command).toEqual({
        type: "modify_candidate",
        targetId: "i-rice",
        sourceText: "아까 밥 반만 먹었어",
      });
    });

    it("proposes a delete candidate when the target is settled", () => {
      const command = decideCommand(
        judgment({
          intent: "delete_food",
          intentConfidence: 0.99,
          referenceTargetId: "i-galbitang",
          referenceConfidence: 0.95,
        }),
        input("갈비탕 잘못 입력했어 지워줘"),
      );
      expect(command).toEqual({
        type: "delete_candidate",
        targetId: "i-galbitang",
      });
    });

    it("asks which entry when none was resolved", () => {
      const command = decideCommand(
        judgment({ intent: "modify_food", referenceTargetId: null }),
        input("아까 그거 절반"),
      );
      expect(command).toMatchObject({
        type: "clarify",
        reason: "unknown_target",
        intent: "modify_food",
      });
      expect(command).toHaveProperty("candidates");
    });

    it("offers the day's entries to choose between, newest first", () => {
      const command = decideCommand(
        judgment({ intent: "delete_food", intentConfidence: 0.99, referenceTargetId: null }),
        input("그거 취소"),
      );
      if (command.type !== "clarify") throw new Error("expected clarify");
      expect(command.candidates?.map((candidate) => candidate.id)).toEqual([
        "i-rice",
        "i-galbitang",
      ]);
    });

    it("discards a target the model was not sure about", () => {
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          referenceTargetId: "i-rice",
          referenceConfidence: 0.2,
        }),
        input(),
      );
      expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    });

    it("trusts a target when the judge reports no reference confidence", () => {
      // The mock resolves by name in code, so it has no choice confidence.
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          referenceTargetId: "i-rice",
          referenceConfidence: null,
        }),
        input(),
      );
      expect(command).toMatchObject({ type: "modify_candidate" });
    });

    it("confirms before a delete read at only middling confidence", () => {
      const command = decideCommand(
        judgment({
          intent: "delete_food",
          intentConfidence: 0.8,
          referenceTargetId: "i-rice",
          referenceConfidence: 0.95,
        }),
        input("그거 취소해줘"),
      );
      expect(command).toMatchObject({
        type: "clarify",
        reason: "confirm_action",
        intent: "delete_food",
      });
    });

    it("would have acted on the same confidence for a modify", () => {
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          intentConfidence: 0.92,
          referenceTargetId: "i-rice",
          referenceConfidence: 0.95,
        }),
        input(),
      );
      expect(command.type).toBe("modify_candidate");
    });

    it("asks when the judge itself wants confirmation", () => {
      const command = decideCommand(
        judgment({
          intent: "delete_food",
          intentConfidence: 0.99,
          clarificationProbability: 0.9,
          referenceTargetId: "i-rice",
          referenceConfidence: 0.95,
        }),
        input("오늘 기록 다 지워줘"),
      );
      expect(command).toMatchObject({ type: "clarify" });
    });
  });

  describe("everything else", () => {
    it("ignores an off-topic message", () => {
      expect(
        decideCommand(judgment({ intent: "other" }), input("다이어트 할 때 야식 어때?")),
      ).toEqual({ type: "ignore", reason: "off_topic" });
    });

    it("asks rather than guessing when the intent itself is unclear", () => {
      const command = decideCommand(
        judgment({ intent: "modify_food", intentConfidence: 0.2 }),
        input("음"),
      );
      expect(command).toEqual({
        type: "clarify",
        reason: "low_confidence",
        intent: "modify_food",
      });
    });

    it("never returns a command that writes to storage", () => {
      const intents = [
        "add_food",
        "modify_food",
        "delete_food",
        "ask_status",
        "ask_recommendation",
        "other",
      ] as const;

      for (const intent of intents) {
        const command = decideCommand(
          judgment({ intent, referenceTargetId: "i-rice", referenceConfidence: 0.99 }),
          input(),
        );
        // Phase 4 stops at candidates; nothing here is a finished mutation.
        expect(command.type).not.toBe("add");
        expect(command.type).not.toBe("modify");
        expect(command.type).not.toBe("delete");
      }
    });
  });
});
