import { describe, expect, it } from "vitest";
import type { JudgmentInput } from "@/ai/judgment/types";
import type { LocalChatRequest, LocalLlmClient, LocalLlmResult } from "./client";
import { buildUserPrompt, createLocalRouter, localRouteSchema } from "./router";

const input: JudgmentInput = {
  message: "아침에 계란 두 개 먹었어",
  now: "2026-09-20T09:00:00+09:00",
  dailyGoalCalories: 2000,
  recentItems: [
    {
      id: "uuid-1",
      name: "두유",
      amount: "1팩",
      calories: 120,
      consumedAt: "2026-09-20T08:10:00+09:00",
    },
  ],
};

describe("createLocalRouter", () => {
  it("asks the client with the route schema and passes the result through", async () => {
    let asked: LocalChatRequest<unknown> | undefined;
    const answer: LocalLlmResult<unknown> = {
      ok: true,
      latencyMs: 12,
      data: {
        intent: "add_food",
        confidence: 0.94,
        consumed: true,
        entities: { foods: [{ name: "계란", quantity: 2, unit: "개" }] },
      },
    };
    const client = {
      model: "m",
      chatJson: async (request: LocalChatRequest<unknown>) => {
        asked = request;
        return answer;
      },
    } as LocalLlmClient;

    const result = await createLocalRouter(client).route(input);

    expect(result).toBe(answer);
    expect(asked?.schema).toBe(localRouteSchema);
    expect(asked?.user).toContain("아침에 계란 두 개 먹었어");
    expect(asked?.system).toContain("delete_food");
    expect(asked?.system).toContain("unknown");
  });
});

describe("buildUserPrompt", () => {
  it("lists today's entries by name and amount, without ids or calories", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("두유 1팩");
    expect(prompt).not.toContain("uuid-1");
    expect(prompt).not.toContain("120");
  });

  it("says so when the log is empty", () => {
    expect(buildUserPrompt({ ...input, recentItems: [] })).toContain("(empty)");
  });
});

describe("localRouteSchema", () => {
  it("rejects an intent outside the list", () => {
    const result = localRouteSchema.safeParse({
      intent: "set_goal",
      confidence: 0.9,
      consumed: false,
      entities: { foods: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a confidence outside 0-1", () => {
    const result = localRouteSchema.safeParse({
      intent: "other",
      confidence: 93,
      consumed: false,
      entities: { foods: [] },
    });
    expect(result.success).toBe(false);
  });
});
