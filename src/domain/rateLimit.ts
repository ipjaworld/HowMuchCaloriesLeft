export type RateLimitRule = {
  key: string;
  windowMs: number;
  /** Positive offset aligns a daily window to KST rather than UTC. */
  offsetMs?: number;
  limit: number;
};

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

/** Implementations must check and consume the entire batch atomically. */
export interface RateLimiter {
  consume(rules: RateLimitRule[]): Promise<RateLimitDecision>;
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
export const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;

export class UsageLimitExceeded extends Error {
  constructor(readonly retryAfter: number) {
    super("Jev daily call limit reached");
    this.name = "UsageLimitExceeded";
  }
}
