import { describe, expect, it, vi } from "vitest";
import { createUsageLimits } from "@/application/usageLimits";
import { DAY_MS, KST_OFFSET_MS } from "@/domain/rateLimit";
import { envSchema } from "@/env";
import { createMemoryRateLimiter } from "./memoryRateLimiter";
import { createUpstashRateLimiter } from "./upstashRateLimiter";

/** Upstash REST /multi-exec for the three commands the limiter sends; each transaction runs whole. */
function fakeUpstash() {
  const values = new Map<string, number>();
  const expiries = new Map<string, number>();
  const requests: { url: string; init: RequestInit; commands: string[][] }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as string[][];
    requests.push({ url: String(url), init: init ?? {}, commands });
    // Yield first, so concurrent callers interleave between transactions.
    await Promise.resolve();
    const results = commands.map(([name, key, arg]) => {
      if (name === "INCR") values.set(key!, (values.get(key!) ?? 0) + 1);
      else if (name === "DECR") values.set(key!, (values.get(key!) ?? 0) - 1);
      else if (name === "PEXPIREAT") expiries.set(key!, Number(arg));
      else return { error: `ERR unknown command ${name}` };
      return { result: name === "PEXPIREAT" ? 1 : values.get(key!) };
    });
    return Response.json(results);
  });
  return { fetcher, values, expiries, requests };
}

const config = { CHAT_PER_MINUTE: 1, CHAT_PER_DAY: 2, RESOLVE_PER_MINUTE: 2, RESOLVE_PER_DAY: 3, JEV_CALLS_PER_DAY: 1 };

describe("shared rate limiter (Upstash)", () => {
  function limiter(fake: ReturnType<typeof fakeUpstash>, now: () => number, fallback = createMemoryRateLimiter({ now })) {
    return createUpstashRateLimiter({ url: "https://redis.test/", token: "tok", fetcher: fake.fetcher as typeof fetch, now, fallback, warn: () => undefined });
  }

  it("admits exactly the limit under concurrency, across what would be separate instances", async () => {
    const fake = fakeUpstash();
    const a = limiter(fake, () => 0);
    const b = limiter(fake, () => 0);
    const rule = [{ key: "jev:all", windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit: 7 }];
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).consume(rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(7);
    // Every denial took its increment back.
    expect([...fake.values.values()]).toEqual([7]);
  });

  it("separates routes and identities and does not charge denied requests to the day", async () => {
    let time = 0;
    const limits = createUsageLimits(limiter(fakeUpstash(), () => time), config);
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(true);
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(false);
    expect((await limits.checkRequest("chat", "b")).allowed).toBe(true);
    expect((await limits.checkRequest("resolve", "a")).allowed).toBe(true);
    time += 60_000;
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(true);
    time += 60_000;
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(false);
  });

  it("sends one authorised transaction with window-scoped keys that expire after the window", async () => {
    const fake = fakeUpstash();
    const time = Date.parse("2026-10-26T03:00:30Z");
    const result = await limiter(fake, () => time).consume([
      { key: "chat:abc", windowMs: 60_000, limit: 5 },
      { key: "chat:abc", windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit: 50 },
    ]);
    expect(result).toEqual({ allowed: true });
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.url).toBe("https://redis.test/multi-exec");
    expect(request?.init.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(request?.commands.map((c) => c[0])).toEqual(["INCR", "PEXPIREAT", "INCR", "PEXPIREAT"]);
    const minuteStart = Date.parse("2026-10-26T03:00:00Z");
    const kstDayStart = Date.parse("2026-10-25T15:00:00Z");
    expect(request?.commands[0]?.[1]).toBe(`hmcl:rl:chat:abc:60000:0:${minuteStart}`);
    expect(fake.expiries.get(`hmcl:rl:chat:abc:60000:0:${minuteStart}`)).toBe(minuteStart + 60_000 + 60_000);
    expect(request?.commands[2]?.[1]).toBe(`hmcl:rl:chat:abc:${DAY_MS}:${KST_OFFSET_MS}:${kstDayStart}`);
  });

  it("reports Retry-After to the end of the blocking window", async () => {
    const fake = fakeUpstash();
    const shared = limiter(fake, () => 59_001);
    const rule = [{ key: "a", windowMs: 60_000, limit: 1 }];
    expect(await shared.consume(rule)).toEqual({ allowed: true });
    expect(await shared.consume(rule)).toEqual({ allowed: false, retryAfter: 1 });
  });

  it.each([
    ["the network fails", async () => { throw new TypeError("offline"); }],
    ["the store answers 401", async () => Response.json({ error: "unauthorized" }, { status: 401 })],
    ["a command fails", async () => Response.json([{ error: "ERR" }, { result: 1 }])],
    ["the reply has the wrong shape", async () => Response.json({ result: "OK" })],
  ])("falls back to the per-instance limiter when %s", async (_, response) => {
    const fallback = { consume: vi.fn(async () => ({ allowed: false as const, retryAfter: 9 })) };
    const warn = vi.fn();
    const shared = createUpstashRateLimiter({ url: "https://redis.test", token: "tok", fetcher: vi.fn(response) as unknown as typeof fetch, now: () => 0, fallback, warn });
    const rule = [{ key: "a", windowMs: 60_000, limit: 1 }];
    expect(await shared.consume(rule)).toEqual({ allowed: false, retryAfter: 9 });
    expect(await shared.consume(rule)).toEqual({ allowed: false, retryAfter: 9 });
    expect(fallback.consume).toHaveBeenCalledTimes(2);
    // One warning a minute, not one per request.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still denies when taking a denied increment back fails", async () => {
    const fake = fakeUpstash();
    const shared = limiter(fake, () => 0);
    const rule = [{ key: "a", windowMs: 60_000, limit: 1 }];
    await shared.consume(rule);
    fake.fetcher.mockImplementationOnce(fake.fetcher.getMockImplementation()!).mockRejectedValueOnce(new TypeError("offline"));
    expect((await shared.consume(rule)).allowed).toBe(false);
  });

  it("rejects invalid and duplicate rules before calling the store", async () => {
    const fake = fakeUpstash();
    const shared = limiter(fake, () => 0);
    await expect(shared.consume([{ key: "a", windowMs: 0, limit: 1 }])).rejects.toThrow("Invalid rate limit rule");
    await expect(shared.consume([{ key: "a", windowMs: 1000, limit: 1 }, { key: "a", windowMs: 1000, limit: 2 }])).rejects.toThrow("Duplicate");
    expect(fake.fetcher).not.toHaveBeenCalled();
  });

  it("stays per-instance unless the shared store is chosen explicitly", () => {
    expect(envSchema.parse({}).RATE_LIMIT_STORE).toBe("memory");
    expect(envSchema.parse({ RATE_LIMIT_STORE: " " }).RATE_LIMIT_STORE).toBe("memory");
    expect(envSchema.safeParse({ RATE_LIMIT_STORE: "redis" }).success).toBe(false);
  });
});
