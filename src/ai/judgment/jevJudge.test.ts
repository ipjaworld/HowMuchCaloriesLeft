import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { createJevJudge } from "./jevJudge";
import { NO_REFERENCE } from "./questions";
import type { JudgmentInput, RecentItem } from "./types";

/**
 * The mapping from a raw API response to a Judgment, exercised against a
 * stub. Nothing here touches the network — `pnpm test` must stay offline.
 * Real accuracy is measured separately by `pnpm eval:jev`.
 */

const RECENT: RecentItem[] = [
  {
    id: "uuid-galbitang",
    name: "갈비탕",
    calories: 650,
    mealType: "lunch",
    consumedAt: "2026-09-20T12:40:00+09:00",
  },
  {
    id: "uuid-rice",
    name: "흰쌀밥",
    amount: "1공기",
    calories: 320,
    mealType: "lunch",
    consumedAt: "2026-09-20T12:41:00+09:00",
  },
];

type Captured = { state: unknown; questions: Record<string, unknown> };

function stubClient(answers: Record<string, unknown>) {
  const calls: Captured[] = [];

  const client = {
    systemOne(request: { state: unknown; questions: Record<string, unknown> }) {
      calls.push({ state: request.state, questions: request.questions });
      return Promise.resolve({
        model: "jev-1.13.0",
        answers,
        usage: { input_tokens: 100, output_tokens: 0 },
      });
    },
  } as unknown as TypeSafeClient;

  return { client, calls };
}

function input(
  message: string,
  recentItems: RecentItem[] = RECENT,
): JudgmentInput {
  return {
    message,
    now: "2026-09-20T13:20:00+09:00",
    dailyGoalCalories: 2100,
    recentItems,
  };
}

const CONFIDENT_ADD = {
  intent: { type: "choice", choice: "add_food", confidence: 0.97, probabilities: {} },
  actual_consumption: { type: "noul", noul: 0.93 },
  clarification: { type: "noul", noul: 0.04 },
};

describe("jev judge", () => {
  it("maps a choice answer and two noul answers onto a Judgment", async () => {
    const { client } = stubClient(CONFIDENT_ADD);
    const judgment = await createJevJudge({ client }).judge(
      input("삼각김밥 하나 먹었어"),
    );

    expect(judgment).toMatchObject({
      intent: "add_food",
      intentConfidence: 0.97,
      actualConsumptionProbability: 0.93,
      clarificationProbability: 0.04,
      referenceTargetId: null,
      referenceConfidence: null,
      source: "jev",
    });
  });

  it("never calls a noul probability a confidence", async () => {
    const { client } = stubClient(CONFIDENT_ADD);
    const judgment = await createJevJudge({ client }).judge(input("갈비탕 먹었어"));

    // The API gives noul answers no confidence field, and neither do we.
    expect(Object.keys(judgment)).not.toContain("actualConsumptionConfidence");
    expect(Object.keys(judgment)).not.toContain("clarificationConfidence");
  });

  it("sends the Korean message through verbatim", async () => {
    const { client, calls } = stubClient(CONFIDENT_ADD);
    await createJevJudge({ client }).judge(input("갈비탕이랑 밥 한 공기 먹음"));

    const state = calls[0]?.state as { message: string };
    expect(state.message).toBe("갈비탕이랑 밥 한 공기 먹음");
  });

  it("asks the reference question only when there is something to refer to", async () => {
    const withItems = stubClient(CONFIDENT_ADD);
    await createJevJudge({ client: withItems.client }).judge(input("갈비탕 먹었어"));
    expect(Object.keys(withItems.calls[0]?.questions ?? {})).toContain("reference");

    const emptyDay = stubClient(CONFIDENT_ADD);
    await createJevJudge({ client: emptyDay.client }).judge(
      input("갈비탕 먹었어", []),
    );
    expect(Object.keys(emptyDay.calls[0]?.questions ?? {})).not.toContain(
      "reference",
    );
  });

  it("resolves the selected label back to the real entry id", async () => {
    const { client, calls } = stubClient({
      intent: { choice: "modify_food", confidence: 0.94 },
      actual_consumption: { noul: 0.88 },
      clarification: { noul: 0.1 },
      // Newest first, so entry_1 is 흰쌀밥.
      reference: { choice: "entry_1", confidence: 0.91 },
    });

    const judgment = await createJevJudge({ client }).judge(
      input("아까 밥 반만 먹었어"),
    );

    expect(judgment.referenceTargetId).toBe("uuid-rice");
    expect(judgment.referenceConfidence).toBe(0.91);

    // The model chose among labels we supplied; it never wrote an id.
    const criteria = (calls[0]?.questions["reference"] as { criteria: object })
      .criteria;
    expect(Object.keys(criteria)).toEqual(["entry_1", "entry_2", NO_REFERENCE]);
  });

  it("returns no target when the model takes the escape option", async () => {
    const { client } = stubClient({
      intent: { choice: "delete_food", confidence: 0.9 },
      actual_consumption: { noul: 0.1 },
      clarification: { noul: 0.8 },
      reference: { choice: NO_REFERENCE, confidence: 0.6 },
    });

    const judgment = await createJevJudge({ client }).judge(input("그거 취소"));
    expect(judgment.referenceTargetId).toBeNull();
    expect(judgment.referenceConfidence).toBe(0.6);
  });

  it("ignores the reference answer for an intent that cannot use one", async () => {
    const { client } = stubClient({
      intent: { choice: "ask_status", confidence: 0.96 },
      actual_consumption: { noul: 0.05 },
      clarification: { noul: 0.05 },
      reference: { choice: "entry_1", confidence: 0.99 },
    });

    const judgment = await createJevJudge({ client }).judge(
      input("오늘 얼마나 남았어?"),
    );
    expect(judgment.referenceTargetId).toBeNull();
    expect(judgment.referenceConfidence).toBeNull();
  });

  it("drops a target the model invented rather than selected", async () => {
    const { client } = stubClient({
      intent: { choice: "modify_food", confidence: 0.9 },
      actual_consumption: { noul: 0.9 },
      clarification: { noul: 0.1 },
      reference: { choice: "흰쌀밥", confidence: 0.99 },
    });

    const judgment = await createJevJudge({ client }).judge(input("아까 밥"));
    expect(judgment.referenceTargetId).toBeNull();
  });

  describe("malformed responses are rejected, not passed on", () => {
    it.each([
      ["an unknown intent label", { intent: { choice: "eat_food", confidence: 0.9 } }],
      ["a confidence out of range", { intent: { choice: "add_food", confidence: 1.4 } }],
      ["a missing confidence", { intent: { choice: "add_food" } }],
      ["a noul out of range", { actual_consumption: { noul: 3 } }],
      ["a missing noul", { actual_consumption: {} }],
    ])("rejects %s", async (_label, override) => {
      const { client } = stubClient({ ...CONFIDENT_ADD, ...override });
      await expect(
        createJevJudge({ client }).judge(input("갈비탕 먹었어")),
      ).rejects.toThrow();
    });
  });
});
