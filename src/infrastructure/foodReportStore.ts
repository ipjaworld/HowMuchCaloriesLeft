import type { FoodReportStore } from "@/application/foodReport";

/** The sorted set of reported names, scored by how often each was reported. */
export const FOOD_REPORT_COUNTS_KEY = "hmcl:food-reports:count";
/** Name → the KST day it was last reported, so a stale request can be told from a live one. */
export const FOOD_REPORT_LAST_KEY = "hmcl:food-reports:last";

/**
 * Food reports in the same Upstash Redis the rate limiter uses, over REST.
 *
 * Unlike the limiter there is no fallback: a report that could not be kept
 * was not made, and the user is told so rather than thanked.
 */
export function createUpstashFoodReportStore({
  url,
  token,
  fetcher = fetch,
  timeoutMs = 1500,
}: {
  url: string;
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): FoodReportStore {
  const endpoint = `${url.replace(/\/+$/, "")}/multi-exec`;
  return {
    async add(name, now) {
      // The day in Korea, like every other day this app counts.
      const day = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
      const commands = [
        ["ZINCRBY", FOOD_REPORT_COUNTS_KEY, "1", name],
        ["HSET", FOOD_REPORT_LAST_KEY, name, day],
      ];
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body: unknown = await response.json();
      if (
        !Array.isArray(body) ||
        body.length !== commands.length ||
        body.some((entry) => typeof entry !== "object" || entry === null || "error" in entry)
      )
        throw new Error("unexpected reply");
    },
  };
}
