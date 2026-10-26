import { createUsageLimits } from "@/application/usageLimits";
import type { RateLimiter } from "@/domain/rateLimit";
import { env } from "@/env";
import { createMemoryRateLimiter } from "./memoryRateLimiter";
import { createRequestIdentity } from "./requestIdentity";
import { createUpstashRateLimiter } from "./upstashRateLimiter";

/** True when the counters are shared across instances (`RATE_LIMIT_STORE=upstash` with credentials). */
export function sharedRateLimitConfigured(): boolean {
  return sharedStore() !== null;
}

function sharedStore(): { url: string; token: string } | null {
  if (env.RATE_LIMIT_STORE !== "upstash") return null;
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function createLimiter(): RateLimiter {
  // Instances and deployments do not share memory counters. That is the
  // fallback and the default, not an account-wide billing guarantee.
  const memory = createMemoryRateLimiter();
  const store = sharedStore();
  if (env.RATE_LIMIT_STORE === "upstash" && store === null)
    console.error("RATE_LIMIT_STORE=upstash without Upstash credentials; using per-instance limits.");
  return store ? createUpstashRateLimiter({ ...store, fallback: memory }) : memory;
}

// Do not persist raw IPs: every key is an HMAC identity.
export const usageLimits = createUsageLimits(createLimiter(), {
  CHAT_PER_MINUTE: env.RATE_LIMIT_CHAT_PER_MINUTE,
  CHAT_PER_DAY: env.RATE_LIMIT_CHAT_PER_DAY,
  RESOLVE_PER_MINUTE: env.RATE_LIMIT_RESOLVE_PER_MINUTE,
  RESOLVE_PER_DAY: env.RATE_LIMIT_RESOLVE_PER_DAY,
  JEV_CALLS_PER_DAY: env.JEV_CALLS_PER_DAY,
});
export const requestIdentity = createRequestIdentity({ secret: env.RATE_LIMIT_SECRET, vercel: env.VERCEL === "1" });
