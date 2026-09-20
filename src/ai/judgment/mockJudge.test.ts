import { describe, expect, it } from "vitest";
import { NOUL_THRESHOLDS } from "./confidence";
import { createMockJudge } from "./mockJudge";
import type { JudgmentInput, RecentItem } from "./types";

const LUNCH: RecentItem[] = [
  {
    id: "i-gimbap",
    name: "삼각김밥",
    amount: "1개",
    calories: 210,
    mealType: "breakfast",
    consumedAt: "2026-09-20T09:10:00+09:00",
  },
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

const judge = createMockJudge();

function ask(message: string, recentItems: RecentItem[] = []) {
  const input: JudgmentInput = {
    message,
    now: "2026-09-20T13:20:00+09:00",
    dailyGoalCalories: 2100,
    recentItems,
  };
  return judge.judge(input);
}

describe("mock judge", () => {
  it("is deterministic — the same sentence always gives the same answer", async () => {
    const first = await ask("갈비탕 먹었어");
    const second = await ask("갈비탕 먹었어");
    expect(first).toEqual(second);
  });

  it("labels itself so QA can tell it apart from Jev", async () => {
    expect((await ask("갈비탕 먹었어")).source).toBe("mock");
  });

  describe("intent", () => {
    it.each([
      ["삼각김밥 하나 먹었어", "add_food"],
      ["아메리카노 마셨어", "add_food"],
      ["아까 밥 반만 먹었어", "modify_food"],
      ["삼각김밥 두개 아니고 하나였어", "modify_food"],
      ["방금 계란 먹었다고 한거 취소", "delete_food"],
      ["두유 기록 삭제", "delete_food"],
      ["오늘 얼마나 남았어?", "ask_status"],
      ["나 지금 몇 칼로리 먹었지?", "ask_status"],
      ["저녁 뭐 먹지?", "ask_recommendation"],
      ["갈비탕 칼로리 높은 편이야?", "other"],
      ["삼각김밥 몇칼로리야?", "other"],
    ] as const)("reads %s as %s", async (message, expected) => {
      expect((await ask(message, LUNCH)).intent).toBe(expected);
    });
  });

  describe("actual consumption", () => {
    it("is high for a report of something eaten", async () => {
      const judgment = await ask("갈비탕이랑 밥 한 공기 먹음");
      expect(judgment.actualConsumptionProbability).toBeGreaterThanOrEqual(
        NOUL_THRESHOLDS.actualConsumption,
      );
    });

    it.each([
      "갈비탕 칼로리 높은 편이야?",
      "제육 먹어도 될까?",
      "오늘 얼마나 남았어?",
      "방금 계란 먹었다고 한거 취소",
    ])("is low for %s", async (message) => {
      const judgment = await ask(message, LUNCH);
      expect(judgment.actualConsumptionProbability).toBeLessThan(
        NOUL_THRESHOLDS.actualConsumption,
      );
    });
  });

  describe("clarification", () => {
    it.each(["밥 먹었어", "좀 먹었음", "라면", "많이 먹었어"])(
      "asks about %s",
      async (message) => {
        const judgment = await ask(message);
        expect(judgment.clarificationProbability).toBeGreaterThanOrEqual(
          NOUL_THRESHOLDS.clarificationNeeded,
        );
      },
    );

    it.each(["삼각김밥 하나 먹었어", "삶은 계란 두 개 먹었어", "우유 200ml 마셨어"])(
      "does not ask about %s",
      async (message) => {
        const judgment = await ask(message);
        expect(judgment.clarificationProbability).toBeLessThan(
          NOUL_THRESHOLDS.clarificationNeeded,
        );
      },
    );
  });

  describe("reference target", () => {
    it("is null when the intent cannot use one", async () => {
      const judgment = await ask("삼각김밥 하나 먹었어", LUNCH);
      expect(judgment.referenceTargetId).toBeNull();
      expect(judgment.referenceConfidence).toBeNull();
    });

    it("picks the most recent entry when a word matches several", async () => {
      // 밥 is inside both 삼각김밥 and 흰쌀밥; lunch came later.
      const judgment = await ask("아까 밥 반만 먹었어", LUNCH);
      expect(judgment.referenceTargetId).toBe("i-rice");
    });

    it("matches through a trailing particle", async () => {
      const judgment = await ask("갈비탕은 국물만 먹었어", LUNCH);
      expect(judgment.referenceTargetId).toBe("i-galbitang");
    });

    it("falls back to the newest entry for 방금", async () => {
      const judgment = await ask("방금 넣은 거 취소해줘", LUNCH);
      expect(judgment.referenceTargetId).toBe("i-rice");
    });

    it("gives up rather than guessing when nothing is named", async () => {
      const judgment = await ask("그거 취소", LUNCH);
      expect(judgment.referenceTargetId).toBeNull();
      expect(judgment.clarificationProbability).toBeGreaterThanOrEqual(
        NOUL_THRESHOLDS.clarificationNeeded,
      );
    });

    it("has nothing to point at when the day is empty", async () => {
      const judgment = await ask("아까 밥 반만 먹었어", []);
      expect(judgment.referenceTargetId).toBeNull();
    });
  });

  it("reports lower confidence when no rule matched", async () => {
    const matched = await ask("삼각김밥 하나 먹었어");
    const guessed = await ask("라면");
    expect(guessed.intentConfidence).toBeLessThan(matched.intentConfidence);
  });
});
