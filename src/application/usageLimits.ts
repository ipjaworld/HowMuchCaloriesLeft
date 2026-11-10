import { DAY_MS, KST_OFFSET_MS, MINUTE_MS, UsageLimitExceeded, type RateLimiter } from "@/domain/rateLimit";

export type UsageLimitConfig = {
  CHAT_PER_MINUTE: number;
  CHAT_PER_DAY: number;
  RESOLVE_PER_MINUTE: number;
  RESOLVE_PER_DAY: number;
  JEV_CALLS_PER_DAY: number;
  PHOTO_PER_MINUTE: number;
  PHOTO_PER_DAY: number;
  PHOTO_CALLS_PER_DAY: number;
  REPORT_PER_MINUTE: number;
  REPORT_PER_DAY: number;
  REPORTS_PER_DAY: number;
};

type Route = "chat" | "resolve" | "photo" | "report";

export function createUsageLimits(limiter: RateLimiter, config: UsageLimitConfig) {
  const perRoute: Record<Route, { minute: number; day: number }> = {
    chat: { minute: config.CHAT_PER_MINUTE, day: config.CHAT_PER_DAY },
    resolve: { minute: config.RESOLVE_PER_MINUTE, day: config.RESOLVE_PER_DAY },
    photo: { minute: config.PHOTO_PER_MINUTE, day: config.PHOTO_PER_DAY },
    report: { minute: config.REPORT_PER_MINUTE, day: config.REPORT_PER_DAY },
  };
  async function beforePaidCall(key: string, limit: number) {
    const result = await limiter.consume([{ key, windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit }]);
    if (!result.allowed) throw new UsageLimitExceeded(result.retryAfter);
  }
  return {
    checkRequest(route: Route, identity: string) {
      const key = `${route}:${identity}`;
      return limiter.consume([
        { key, windowMs: MINUTE_MS, limit: perRoute[route].minute },
        { key, windowMs: DAY_MS, offsetMs: KST_OFFSET_MS, limit: perRoute[route].day },
      ]);
    },
    beforeJevCall: () => beforePaidCall("jev:all", config.JEV_CALLS_PER_DAY),
    /** The whole service's photo readings for the day: a ceiling on spend. */
    beforePhotoCall: () => beforePaidCall("photo:all", config.PHOTO_CALLS_PER_DAY),
    /** Every food report the service accepts in a day: a ceiling on what one day can add to the list. */
    beforeFoodReport: () => beforePaidCall("report:all", config.REPORTS_PER_DAY),
  };
}

export function usageLimitResponse(
  error: "rate_limited" | "jev_daily_limit" | "photo_daily_limit" | "report_daily_limit",
  retryAfter: number,
): Response {
  return Response.json({ error }, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
}
