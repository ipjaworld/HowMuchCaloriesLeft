import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { envSchema } from "@/env";
import { candidateJudgeFor, createJevCandidateJudge } from "./candidateJudge";

/**
 * The per-food filter is an experiment that ships switched off. These pin
 * the switch: what turns it on, what keeps it off, and how one request is
 * made when it is on.
 */

describe("FOOD_CANDIDATE_FILTER", () => {
  it("is off when unset", () => {
    const env = envSchema.parse({});
    expect(env.FOOD_CANDIDATE_FILTER).toBe("off");
    expect(env.FOOD_CANDIDATE_TIMEOUT_MS).toBe(1500);
  });

  it("is off when blank", () => {
    expect(envSchema.parse({ FOOD_CANDIDATE_FILTER: "" }).FOOD_CANDIDATE_FILTER).toBe("off");
  });

  it("refuses anything but off or on", () => {
    expect(envSchema.safeParse({ FOOD_CANDIDATE_FILTER: "true" }).success).toBe(false);
  });
});

describe("candidateJudgeFor", () => {
  const key = "ts_test_key";

  it("gives no judge when the filter is off, key or not", () => {
    expect(candidateJudgeFor({ FOOD_CANDIDATE_FILTER: "off", FOOD_CANDIDATE_TIMEOUT_MS: 1500, TYPESAFE_API_KEY: key })).toBeNull();
  });

  it("gives no judge without a key, even when on", () => {
    expect(candidateJudgeFor({ FOOD_CANDIDATE_FILTER: "on", FOOD_CANDIDATE_TIMEOUT_MS: 1500 })).toBeNull();
  });

  it("gives a judge only when on and keyed", () => {
    expect(candidateJudgeFor({ FOOD_CANDIDATE_FILTER: "on", FOOD_CANDIDATE_TIMEOUT_MS: 1500, TYPESAFE_API_KEY: key })).not.toBeNull();
  });
});

describe("createJevCandidateJudge", () => {
  function fakeClient(answers: Record<string, unknown>) {
    const systemOne = vi.fn(() =>
      Promise.resolve({ model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 0 } }),
    );
    return { client: { systemOne } as unknown as TypeSafeClient, systemOne };
  }

  it("makes one attempt, bounded by the timeout, with only the phrases it is given", async () => {
    const { client, systemOne } = fakeClient({ c1: { type: "noul", noul: 0.04 }, c2: { type: "noul", noul: 0.97 } });
    const judge = createJevCandidateJudge({ client, timeoutMs: 1500 });

    expect(await judge.judgeEaten("팀원들이랑 딸기케이크 먹었어", ["팀원들", "딸기케이크"])).toEqual([0.04, 0.97]);

    const [request, options] = systemOne.mock.calls[0] as unknown as [
      { state: { message: string; food_candidates: Record<string, { phrase: string }> } },
      { timeout: number; retry: { maxRetries: number } },
    ];
    expect(request.state.food_candidates).toEqual({ c1: { phrase: "팀원들" }, c2: { phrase: "딸기케이크" } });
    expect(options).toEqual({ timeout: 1500, retry: { maxRetries: 0 } });
  });

  it("sends nothing for no phrases", async () => {
    const { client, systemOne } = fakeClient({});
    expect(await createJevCandidateJudge({ client, timeoutMs: 1500 }).judgeEaten("x", [])).toEqual([]);
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("throws on a malformed answer, so the caller falls back to asking", async () => {
    const { client } = fakeClient({ c1: { type: "noul", noul: "high" } });
    await expect(createJevCandidateJudge({ client, timeoutMs: 1500 }).judgeEaten("x", ["a"])).rejects.toThrow();
  });
});
