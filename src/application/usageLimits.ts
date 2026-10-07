import { DAY_MS, KST_OFFSET_MS, MINUTE_MS, UsageLimitExceeded, type RateLimiter } from "@/domain/rateLimit";

export type UsageLimitConfig = {
  CHAT_PER_MINUTE: number;
  CHAT_PER_DAY: number;
  RESOLVE_PER_MINUTE: number;
  RESOLVE_PER_DAY: number;
  JEV_CALLS_PER_DAY: number;
};

export function createUsageLimits(limiter: RateLimiter, config: UsageLimitConfig) {
  return {
    checkRequest(route: "chat" | "resolve", identity: string) {
      const key = `${route}:${identity}`;
      return limiter.consume([
        { key, windowMs: MINUTE_MS, limit: route === "chat" ? config.CHAT_PER_MINUTE : config.RESOLVE_PER_MINUTE },
        { key, windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit: route === "chat" ? config.CHAT_PER_DAY : config.RESOLVE_PER_DAY },
      ]);
    },
    async beforeJevCall() {
      const result = await limiter.consume([{ key: "jev:all", windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit: config.JEV_CALLS_PER_DAY }]);
      if (!result.allowed) throw new UsageLimitExceeded(result.retryAfter);
    },
  };
}

export function usageLimitResponse(error: "rate_limited" | "jev_daily_limit", retryAfter: number): Response {
  return Response.json({ error }, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
}
