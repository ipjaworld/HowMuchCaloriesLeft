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

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  /**
   * TypeSafe AI (Jev) — structured judgment.
   * Absent is a supported state: the judgment layer falls back to a
   * deterministic mock so the app stays usable without a key. (Phase 4)
   */
  TYPESAFE_API_KEY: optionalSecret,

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
