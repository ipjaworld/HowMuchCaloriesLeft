import type { RateLimitDecision, RateLimiter, RateLimitRule } from "@/domain/rateLimit";

type Fetch = typeof fetch;

/** Counters live a little past their window so a slow clock never revives one. */
const EXPIRY_GRACE_MS = 60_000;

/**
 * Counters shared by every instance, in Upstash Redis over its REST API.
 *
 * One request's rules are incremented in a single MULTI/EXEC, so concurrent
 * requests can never be admitted past a limit. A denied request takes its
 * increments back in a second transaction — the same "denials are not
 * charged" behaviour as the memory limiter, except that for that moment a
 * neighbour may be denied too. That errs towards denying, never admitting.
 *
 * Any failure — network, timeout, an error entry, a reply of the wrong
 * shape — falls back to `fallback`, the per-instance memory limiter, so the
 * store going down limits less precisely instead of taking the app down.
 * Keys are the HMAC identities the caller already uses; no raw IP is sent.
 */
export function createUpstashRateLimiter({
  url,
  token,
  fallback,
  fetcher = fetch,
  now = Date.now,
  timeoutMs = 1000,
  warn = (message: string) => console.warn(message),
}: {
  url: string;
  token: string;
  fallback: RateLimiter;
  fetcher?: Fetch;
  now?: () => number;
  timeoutMs?: number;
  warn?: (message: string) => void;
}): RateLimiter {
  const endpoint = `${url.replace(/\/+$/, "")}/multi-exec`;
  let nextWarning = 0;

  async function transaction(commands: string[][]): Promise<unknown[]> {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body) || body.length !== commands.length) throw new Error("unexpected reply");
    return body.map((entry) => {
      if (typeof entry !== "object" || entry === null || "error" in entry || !("result" in entry)) throw new Error("command failed");
      return (entry as { result: unknown }).result;
    });
  }

  return {
    async consume(rules: RateLimitRule[]): Promise<RateLimitDecision> {
      const time = now();
      const pending = rules.map((rule) => {
        if (!Number.isSafeInteger(rule.limit) || rule.limit < 1 || !Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1) throw new Error("Invalid rate limit rule");
        const offset = rule.offsetMs ?? 0;
        const start = Math.floor((time + offset) / rule.windowMs) * rule.windowMs - offset;
        return { key: `hmcl:rl:${rule.key}:${rule.windowMs}:${offset}:${start}`, limit: rule.limit, end: start + rule.windowMs };
      });
      if (new Set(pending.map((entry) => entry.key)).size !== pending.length) throw new Error("Duplicate rate limit bucket");

      let counts: number[];
      try {
        const results = await transaction(
          pending.flatMap((entry) => [["INCR", entry.key], ["PEXPIREAT", entry.key, String(entry.end + EXPIRY_GRACE_MS)]]),
        );
        counts = pending.map((_, index) => results[index * 2] as number);
        if (!counts.every((count) => Number.isSafeInteger(count) && count > 0)) throw new Error("unexpected count");
      } catch (error) {
        if (time >= nextWarning) {
          warn(`Shared rate limiter unavailable, using per-instance limits: ${error instanceof Error ? error.message : "unknown"}`);
          nextWarning = time + 60_000;
        }
        return fallback.consume(rules);
      }

      const blocked = pending.filter((entry, index) => (counts[index] ?? 0) > entry.limit);
      if (blocked.length === 0) return { allowed: true };
      // Best effort: if this fails the counters stay high until they expire,
      // which only denies more, never admits more.
      await transaction(pending.map((entry) => ["DECR", entry.key])).catch(() => undefined);
      return { allowed: false, retryAfter: Math.max(1, ...blocked.map((entry) => Math.ceil((entry.end - time) / 1000))) };
    },
  };
}
