import { createUsageLimits } from "@/application/usageLimits";
import { env } from "@/env";
import { createMemoryRateLimiter } from "./memoryRateLimiter";
import { createRequestIdentity } from "./requestIdentity";

// Instances and deployments do not share these counters. This is a temporary
// adapter, not an account-wide billing guarantee. Do not persist raw IPs.
export const usageLimits = createUsageLimits(createMemoryRateLimiter(), {
  CHAT_PER_MINUTE: env.RATE_LIMIT_CHAT_PER_MINUTE,
  CHAT_PER_DAY: env.RATE_LIMIT_CHAT_PER_DAY,
  RESOLVE_PER_MINUTE: env.RATE_LIMIT_RESOLVE_PER_MINUTE,
  RESOLVE_PER_DAY: env.RATE_LIMIT_RESOLVE_PER_DAY,
  JEV_CALLS_PER_DAY: env.JEV_CALLS_PER_DAY,
});
export const requestIdentity = createRequestIdentity({ secret: env.RATE_LIMIT_SECRET, vercel: env.VERCEL === "1" });
