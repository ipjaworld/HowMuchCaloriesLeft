import { describe, expect, it, vi } from "vitest";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { createJevJudge } from "@/ai/judgment/jevJudge";
import { createUsageLimits } from "@/application/usageLimits";
import { DAY_MS, KST_OFFSET_MS, UsageLimitExceeded } from "@/domain/rateLimit";
import { createMemoryRateLimiter } from "./memoryRateLimiter";
import { createRequestIdentity } from "./requestIdentity";
import { createJevCandidateJudge } from "@/ai/judgment/candidateJudge";
import { createJudge } from "@/ai/judgment";
import { envSchema } from "@/env";

const config = { CHAT_PER_MINUTE: 1, CHAT_PER_DAY: 2, RESOLVE_PER_MINUTE: 2, RESOLVE_PER_DAY: 3, JEV_CALLS_PER_DAY: 1 };
describe("usage limits", () => {
  it("uses optional defaults and rejects invalid configuration", () => {
    const env = envSchema.parse({ RATE_LIMIT_CHAT_PER_MINUTE: " " });
    expect(env.RATE_LIMIT_CHAT_PER_MINUTE).toBe(20);
    expect(env.JEV_CALLS_PER_DAY).toBe(2000);
    for (const value of ["0", "-1", "1.5", "no", "1000001"]) expect(envSchema.safeParse({ JEV_CALLS_PER_DAY: value }).success).toBe(false);
  });
  it("shares the cap with optional candidate calls while no-key mock consumes nothing", async () => {
    const limits = createUsageLimits(createMemoryRateLimiter({ now: () => 0 }), config);
    await limits.beforeJevCall();
    const systemOne = vi.fn();
    const candidate = createJevCandidateJudge({ client: { systemOne } as unknown as TypeSafeClient, timeoutMs: 1500, beforeCall: limits.beforeJevCall });
    await expect(candidate.judgeEaten("먹었어", ["음식"])).rejects.toBeInstanceOf(UsageLimitExceeded);
    expect(systemOne).not.toHaveBeenCalled();
    const guard = vi.fn(limits.beforeJevCall);
    await createJudge(undefined, guard).judge({ message: "커피 먹었어", now: "2026-10-07T12:00:00+09:00", recentItems: [], dailyGoalCalories: null });
    expect(guard).not.toHaveBeenCalled();
  });
  it("rounds Retry-After up and resets at a fixed window boundary", async () => {
    let time = 59_001;
    const limiter = createMemoryRateLimiter({ now: () => time });
    const rule = [{ key: "a", windowMs: 60_000, limit: 1 }];
    expect(await limiter.consume(rule)).toEqual({ allowed: true });
    expect(await limiter.consume(rule)).toEqual({ allowed: false, retryAfter: 1 });
    time = 60_000;
    expect(await limiter.consume(rule)).toEqual({ allowed: true });
  });
  it("atomically admits concurrent requests without overshooting", async () => {
    const limiter = createMemoryRateLimiter({ now: () => 0 });
    const results = await Promise.all(Array.from({ length: 100 }, () => limiter.consume([{ key: "a", windowMs: 60_000, limit: 7 }])));
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
  });
  it("separates routes and identities and does not charge denied requests to the day", async () => {
    let time = 0;
    const limits = createUsageLimits(createMemoryRateLimiter({ now: () => time }), config);
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(true);
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(false);
    expect((await limits.checkRequest("chat", "b")).allowed).toBe(true);
    expect((await limits.checkRequest("resolve", "a")).allowed).toBe(true);
    time += 60_000;
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(true);
    time += 60_000;
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(false);
  });
  it("resets daily counters at KST midnight regardless of process timezone", async () => {
    let time = Date.parse("2026-10-07T14:59:59.001Z");
    const limiter = createMemoryRateLimiter({ now: () => time });
    const rule = [{ key: "day", windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit: 1 }];
    await limiter.consume(rule);
    expect(await limiter.consume(rule)).toEqual({ allowed: false, retryAfter: 1 });
    time = Date.parse("2026-10-07T15:00:00Z");
    expect((await limiter.consume(rule)).allowed).toBe(true);
  });
  it("bounds memory without evicting active identities", async () => {
    let time = 0;
    const limiter = createMemoryRateLimiter({ now: () => time, maxEntries: 1 });
    const rule = (key: string) => [{ key, windowMs: 60_000, limit: 1 }];
    await limiter.consume(rule("a"));
    expect((await limiter.consume(rule("b"))).allowed).toBe(false);
    expect((await limiter.consume(rule("a"))).allowed).toBe(false);
    time = 60_000;
    expect((await limiter.consume(rule("b"))).allowed).toBe(true);
  });
  it("does not call the actual Jev client at the cap, counts failures, and disables SDK retries", async () => {
    let time = Date.parse("2026-10-07T14:59:59Z");
    const limits = createUsageLimits(createMemoryRateLimiter({ now: () => time }), config);
    const systemOne = vi.fn().mockRejectedValue(new Error("upstream failed"));
    const judge = createJevJudge({ client: { systemOne } as unknown as TypeSafeClient, beforeCall: limits.beforeJevCall });
    const input = { message: "커피", now: new Date(time).toISOString(), dailyGoalCalories: null, recentItems: [] };
    await expect(judge.judge(input)).rejects.toThrow("upstream failed");
    await expect(judge.judge(input)).rejects.toBeInstanceOf(UsageLimitExceeded);
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne.mock.calls[0]?.[1]).toMatchObject({ retry: { maxRetries: 0 } });
    time += 1000;
    await expect(judge.judge(input)).rejects.toThrow("upstream failed");
    expect(systemOne).toHaveBeenCalledTimes(2);
  });
});

describe("private request identities", () => {
  const headers = (ip: string) => new Headers({ "x-vercel-forwarded-for": ip });
  it("HMACs only the trusted header and never logs addresses", () => {
    const log = vi.spyOn(console, "log"); const error = vi.spyOn(console, "error");
    try {
      const identify = createRequestIdentity({ secret: "one", vercel: true });
      const result = identify(headers("203.0.113.1"));
      expect(result).toMatch(/^[a-f0-9]{64}$/);
      expect(result).not.toContain("203.0.113.1");
      expect(identify(new Headers({ "x-forwarded-for": "203.0.113.1" }))).not.toBe(result);
      expect(createRequestIdentity({ secret: "two", vercel: true })(headers("203.0.113.1"))).not.toBe(result);
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally { log.mockRestore(); error.mockRestore(); }
  });
  it("uses a random per-instance secret and one unspoofable local bucket without a secret", () => {
    const a = createRequestIdentity(); const b = createRequestIdentity();
    expect(a(headers("203.0.113.1"))).toBe(a(headers("203.0.113.2")));
    expect(a(new Headers())).not.toBe(b(new Headers()));
  });
  it("canonicalizes IPv6 and safely groups malformed or scoped addresses", () => {
    const identify = createRequestIdentity({ secret: "one", vercel: true });
    expect(identify(headers("2001:db8::1"))).toBe(identify(headers("2001:0db8:0:0:0:0:0:1")));
    for (const ip of ["", "not-ip", "203.0.113.1, 203.0.113.2", "fe80::1%eth0"]) expect(identify(headers(ip))).toBe(identify(new Headers()));
  });
});
