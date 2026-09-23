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
        needsConfirmation: false,
      });
    });

    it("refuses to log a question about a food", () => {
      const command = decideCommand(
        judgment({ actualConsumptionProbability: 0.1 }),
        input("갈비탕 칼로리 높은 편이야?"),
      );
      expect(command).toEqual({ type: "ignore", reason: "not_consumption" });
    });

    it("does not let the clarification noul override the resolver", () => {
      // Phase 4.5 measured this noul as the weakest of the four in Korean:
      // its two distributions overlap almost end to end, and it fires on
      // plain reports. Which food and how much is a question the dataset
      // answers with certainty, so the add goes through and the resolver
      // decides whether anything needs asking.
      const command = decideCommand(
        judgment({ clarificationProbability: 0.99 }),
        input("밥 먹었어"),
      );
      expect(command).toMatchObject({ type: "add_candidate" });
    });

    it("still consults it for a modify, where no resolver can answer", () => {
      // Which existing entry is meant is not something the dataset knows.
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          referenceTargetId: "i-rice",
          referenceConfidence: 0.9,
          clarificationProbability: 0.99,
        }),
        input("아까 밥 반만 먹었어"),
      );
      expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    });

    it("flags a middling reading for confirmation but still looks it up", () => {
      // Turning this into a bare "shall I?" would throw the sentence away and
      // leave a yes with nothing to act on. The lookup happens either way and
      // the confirmation is asked over the top of it.
      const command = decideCommand(
        judgment({ intentConfidence: 0.6 }),
        input("라면"),
      );
      expect(command).toEqual({
        type: "add_candidate",
        sourceText: "라면",
        needsConfirmation: true,
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
        needsConfirmation: false,
        // Filled in by the route, which owns the dataset; `decideCommand`
        // stays a pure function over the judgment.
        parts: [],
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

    it("discards a target the model was not sure about and resolves it in code", () => {
      // Jev points at the 갈비탕 entry but reports 0.2, under the floor. The
      // pick is dropped, and the code heuristic reads "밥" as the 흰쌀밥
      // entry — so the low-confidence answer is not merely passed through.
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          referenceTargetId: "i-galbitang",
          referenceConfidence: 0.2,
        }),
        input(),
      );
      expect(command).toMatchObject({
        type: "modify_candidate",
        targetId: "i-rice",
      });
    });

    it("asks when neither the model nor the heuristic can name a target", () => {
      const command = decideCommand(
        judgment({
          intent: "modify_food",
          referenceTargetId: "i-rice",
          referenceConfidence: 0.2,
        }),
        input("아까 그거 절반"),
      );
      expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    });

    it("falls back to the newest entry for a deictic reference", () => {
      // The one reference Jev missed on the golden set: it named nothing and
      // said so (conf 0.29). "방금 넣은 거" means the last thing added.
      const command = decideCommand(
        judgment({
          intent: "delete_food",
          intentConfidence: 0.99,
          actualConsumptionProbability: 0.14,
          referenceTargetId: null,
          referenceConfidence: 0.29,
        }),
        input("방금 넣은 거 취소해줘"),
      );
      expect(command).toMatchObject({
        type: "delete_candidate",
        targetId: "i-rice",
      });
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

describe("a delete never breaks a tie by itself", () => {
  const twoRices: RecentItem[] = [
    { id: "i-rice", name: "쌀밥", amount: "한 공기", calories: 351, consumedAt: "2026-09-20T12:00:00+09:00" },
    { id: "i-gimbap", name: "김밥", amount: "한 줄", calories: 322, consumedAt: "2026-09-20T13:00:00+09:00" },
  ];

  function withItems(message: string, items: RecentItem[]): JudgmentInput {
    return { message, now: "2026-09-20T14:00:00+09:00", dailyGoalCalories: 2100, recentItems: items };
  }

  it("asks which one when the wording fits two different entries", () => {
    // "밥" is inside both 김밥 and 쌀밥, and they are 29 kcal apart. Picking
    // by recency here removes the wrong food and the wrong number.
    const command = decideCommand(
      judgment({
        intent: "delete_food",
        intentConfidence: 1,
        referenceTargetId: "i-rice",
        referenceConfidence: 0.99,
      }),
      withItems("밥 지워줘", twoRices),
    );

    expect(command).toMatchObject({
      type: "clarify",
      reason: "unknown_target",
      intent: "delete_food",
    });
    if (command.type !== "clarify") return;
    expect(command.candidates?.map((c) => c.id).sort()).toEqual(["i-gimbap", "i-rice"]);
  });

  it("overrides even a confident pick from the model", () => {
    // The guard is about what a delete is allowed to do, not about how sure
    // the judge was — so it applies whoever supplied the target.
    const command = decideCommand(
      judgment({
        intent: "delete_food",
        intentConfidence: 1,
        referenceTargetId: "i-gimbap",
        referenceConfidence: 1,
      }),
      withItems("밥 지워줘", twoRices),
    );
    expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
  });

  it("does not ask when only one entry fits", () => {
    const command = decideCommand(
      judgment({
        intent: "delete_food",
        intentConfidence: 1,
        referenceTargetId: "i-gimbap",
        referenceConfidence: 0.99,
      }),
      withItems("김밥 지워줘", twoRices),
    );
    expect(command).toEqual({ type: "delete_candidate", targetId: "i-gimbap" });
  });

  it("does not ask between entries that are indistinguishable", () => {
    // Same food, same figure: either choice removes the same number from the
    // same day, so a question would be friction for nothing.
    const twins: RecentItem[] = [
      { id: "a", name: "갈비탕", amount: "하나", calories: 362, consumedAt: "2026-09-20T12:00:00+09:00" },
      { id: "b", name: "갈비탕", amount: "하나", calories: 362, consumedAt: "2026-09-20T13:00:00+09:00" },
    ];
    const command = decideCommand(
      judgment({
        intent: "delete_food",
        intentConfidence: 1,
        referenceTargetId: "b",
        referenceConfidence: 0.99,
      }),
      withItems("갈비탕 지워줘", twins),
    );
    expect(command).toEqual({ type: "delete_candidate", targetId: "b" });
  });

  it("leaves a modify free to take the most recent match", () => {
    // A correction is visible and reversible; "아까 밥" almost always means
    // the recent one, and asking every time would be noise.
    const command = decideCommand(
      judgment({
        intent: "modify_food",
        intentConfidence: 1,
        referenceTargetId: "i-rice",
        referenceConfidence: 0.99,
      }),
      withItems("밥 반만 먹었어", twoRices),
    );
    expect(command).toMatchObject({ type: "modify_candidate", targetId: "i-rice" });
  });
});

describe("a middling correction is confirmed, not discarded", () => {
  it("still carries its lookup, so a yes has something to apply", () => {
    const command = decideCommand(
      judgment({
        intent: "modify_food",
        intentConfidence: 0.6,
        referenceTargetId: "i-rice",
        referenceConfidence: 0.99,
      }),
      input("아까 밥 반만 먹었어"),
    );
    expect(command).toMatchObject({
      type: "modify_candidate",
      targetId: "i-rice",
      needsConfirmation: true,
    });
  });

  it("but a middling delete asks outright, having nothing to carry", () => {
    const command = decideCommand(
      judgment({
        intent: "delete_food",
        intentConfidence: 0.8,
        referenceTargetId: "i-rice",
        referenceConfidence: 0.99,
      }),
      input("아까 밥 취소"),
    );
    expect(command).toMatchObject({
      type: "clarify",
      reason: "confirm_action",
      intent: "delete_food",
    });
  });
});
