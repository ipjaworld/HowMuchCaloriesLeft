import type { RateLimiter, RateLimitRule } from "@/domain/rateLimit";

/** Process-local best effort only. A shared implementation must use atomic writes. */
export function createMemoryRateLimiter({ now = Date.now, maxEntries = 50_000 }: {
  now?: () => number; maxEntries?: number;
} = {}): RateLimiter {
  const buckets = new Map<string, { count: number; start: number; end: number }>();
  let nextSweep = 0;
  return {
    async consume(rules: RateLimitRule[]) {
      const time = now();
      if (time >= nextSweep || buckets.size + rules.length > maxEntries) {
        for (const [key, bucket] of buckets) if (bucket.end <= time) buckets.delete(key);
        nextSweep = time + 60_000;
      }
      const pending = rules.map((rule) => {
        if (!Number.isSafeInteger(rule.limit) || rule.limit < 1 || !Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1) throw new Error("Invalid rate limit rule");
        const offset = rule.offsetMs ?? 0;
        const start = Math.floor((time + offset) / rule.windowMs) * rule.windowMs - offset;
        const key = JSON.stringify([rule.key, rule.windowMs, offset]);
        const existing = buckets.get(key);
        return { key, limit: rule.limit, start, end: start + rule.windowMs, count: existing?.start === start ? existing.count : 0 };
      });
      // Duplicate buckets would otherwise undercount a batch.
      if (new Set(pending.map((entry) => entry.key)).size !== pending.length) throw new Error("Duplicate rate limit bucket");
      const blocked = pending.filter((entry) => entry.count >= entry.limit);
      if (blocked.length > 0) return { allowed: false, retryAfter: Math.max(1, ...blocked.map((entry) => Math.ceil((entry.end - time) / 1000))) };
      if (buckets.size + pending.filter((entry) => !buckets.has(entry.key)).length > maxEntries) {
        // Never evict a live counter to admit a new identity: that would reset
        // limits under load. Bound memory and reject until a counter expires.
        let earliest = time + 60_000;
        for (const bucket of buckets.values()) earliest = Math.min(earliest, bucket.end);
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((earliest - time) / 1000)) };
      }
      // No await between the check and commit, including concurrent callers.
      for (const entry of pending) buckets.set(entry.key, { count: entry.count + 1, start: entry.start, end: entry.end });
      return { allowed: true };
    },
  };
}
