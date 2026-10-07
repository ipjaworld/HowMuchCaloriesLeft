import { z } from "zod";

/**
 * Server-side environment schema.
 *
 * Every secret in this project (Jev, LLM fallback) is used *only* on the
 * server — route handlers and server modules. Nothing here is ever exposed to
 * the browser, so there are deliberately no `NEXT_PUBLIC_*` entries.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "src/env.ts was imported from client code. Secrets must stay on the server.",
  );
}

/** Treats an unset variable and an empty string (`KEY=`) as the same thing. */
const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

/** Lets `KEY=` fall through to the schema's default, like an unset key. */
function blankAsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema,
  );
}

/** Exported for tests of the defaults; the app reads `env` below. */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  /**
   * TypeSafe AI (Jev) — structured judgment.
   * Absent is a supported state: the judgment layer falls back to a
   * deterministic mock so the app stays usable without a key. (Phase 4)
   */
  TYPESAFE_API_KEY: optionalSecret,

  /** Vercel sets this itself; request headers cannot enable proxy trust. */
  VERCEL: z.string().optional(),
  /** Unset: a random process-lifetime HMAC secret, matching memory lifetime. */
  RATE_LIMIT_SECRET: optionalSecret,
  // Provisional beta limits: a meal usually takes one chat request, with
  // selections handled locally and quantity follow-ups using resolve. Leave
  // room for corrections and shared household IPs. These are abuse limits,
  // not a derivation of the provider's separate API quota.
  RATE_LIMIT_CHAT_PER_MINUTE: blankAsUnset(z.coerce.number().int().positive().max(1_000_000).default(20)),
  RATE_LIMIT_CHAT_PER_DAY: blankAsUnset(z.coerce.number().int().positive().max(1_000_000).default(200)),
  RATE_LIMIT_RESOLVE_PER_MINUTE: blankAsUnset(z.coerce.number().int().positive().max(1_000_000).default(60)),
  RATE_LIMIT_RESOLVE_PER_DAY: blankAsUnset(z.coerce.number().int().positive().max(1_000_000).default(600)),
  // Provisional: 100 beta users × 20 paid attempts/day, including optional
  // per-food judgment. Counts attempts, not tokens or guaranteed spend.
  JEV_CALLS_PER_DAY: blankAsUnset(z.coerce.number().int().positive().max(1_000_000).default(2000)),

  /**
   * Anthropic — LLM *fallback* parser only, for food name + quantity
   * extraction when the local dataset and Jev candidate selection both come up
   * empty. It never produces calorie numbers. (Phase 5)
   */
  ANTHROPIC_API_KEY: optionalSecret,

  /**
   * Ministry of Food and Drug Safety (식약처) open API — the food
   * nutrition database behind `NutritionResolver`. Used by the offline sync
   * script, not by the running app: the app reads the dataset file the sync
   * produces, so a missing key here only means the dataset cannot be
   * refreshed. (Phase 5B)
   */
  MFDS_FOOD_NUTRITION_API_KEY: optionalSecret,

  /** Endpoint for the above. Defaulted so only the key has to be supplied. */
  MFDS_FOOD_NUTRITION_ENDPOINT: z
    .string()
    .min(1)
    .default("https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03"),

  /**
   * Local LLM router experiment (Ollama). Development only — see
   * `docs/local-llm.md`. `off` is the app exactly as it was; production is
   * forced to `off` whatever this says (`effectiveLocalMode`).
   */
  LOCAL_LLM_MODE: blankAsUnset(z.enum(["off", "shadow", "active"]).default("off")),
  LOCAL_LLM_BASE_URL: blankAsUnset(z.url().default("http://localhost:11434")),
  /** Any Ollama tag. Unset means the experiment cannot run, so it stays off. */
  LOCAL_LLM_MODEL: optionalSecret,
  LOCAL_LLM_TIMEOUT_MS: blankAsUnset(z.coerce.number().int().positive().default(5000)),
  /** A local answer below this is not used; the judge answers instead. */
  LOCAL_LLM_MIN_CONFIDENCE: blankAsUnset(z.coerce.number().min(0).max(1).default(0.85)),

  /**
   * Phase 8 per-food filter: a second Jev request, sent alongside the intent
   * request, that drops questions about phrases the user did not eat. `off`
   * is the app exactly as it was. See `application/candidateFilter.ts`.
   */
  FOOD_CANDIDATE_FILTER: blankAsUnset(z.enum(["off", "on"]).default("off")),
  /** One attempt, no retries; past this the sentence is asked about as before. */
  FOOD_CANDIDATE_TIMEOUT_MS: blankAsUnset(z.coerce.number().int().positive().default(1500)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables:\n${z.prettifyError(parsed.error)}`,
  );
}

export const env = parsed.data;

/** Jev is reachable; otherwise the judgment layer uses its mock implementation. */
export const hasTypeSafeKey = env.TYPESAFE_API_KEY !== undefined;

/** The LLM fallback parser is available; otherwise resolution stops at "unknown". */
export const hasLlmFallbackKey = env.ANTHROPIC_API_KEY !== undefined;

/** The nutrition dataset can be re-synced from the MFDS open API. */
export const hasMfdsKey = env.MFDS_FOOD_NUTRITION_API_KEY !== undefined;
