import { normalizeFoodReport, type FoodReportStore } from "@/application/foodReport";
import { usageLimitResponse } from "@/application/usageLimits";
import { UsageLimitExceeded } from "@/domain/rateLimit";
import { createUpstashFoodReportStore } from "@/infrastructure/foodReportStore";
import { foodReportEnabled, requestIdentity, sharedStore, usageLimits } from "@/infrastructure/serverUsageLimits";

/**
 * One food name the user chose to tell the operator about.
 *
 * The body is the name and nothing else, and nothing about the request is
 * stored beside it: the identity is used for the rate limit and goes no
 * further. While `FOOD_REPORT` is off, or there is no shared store to keep
 * reports in, this route answers 404.
 */

let store: FoodReportStore | null = null;
function foodReportStore(): FoodReportStore {
  const credentials = sharedStore();
  if (credentials === null) throw new Error("no shared store");
  store ??= createUpstashFoodReportStore(credentials);
  return store;
}

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  if (!foodReportEnabled()) return Response.json({ error: "not_found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = normalizeFoodReport(typeof body === "object" && body !== null ? (body as { name?: unknown }).name : null);
  if (name === null) return Response.json({ error: "invalid_name" }, { status: 400 });

  try {
    const admission = await usageLimits.checkRequest("report", requestIdentity(request.headers));
    if (!admission.allowed) return usageLimitResponse("rate_limited", admission.retryAfter);
    await usageLimits.beforeFoodReport();
    await foodReportStore().add(name, new Date());
    return Response.json({ reported: true }, { headers: noStore });
  } catch (error) {
    if (error instanceof UsageLimitExceeded) return usageLimitResponse("report_daily_limit", error.retryAfter);
    console.error("[food-report] not kept", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "report_unavailable" }, { status: 503, headers: noStore });
  }
}
