import { createJevJudge } from "./jevJudge";
import { createMockJudge } from "./mockJudge";
import type { Judge } from "./types";

/**
 * Picks the judge. Server-only: `createJevJudge` constructs a TypeSafe client,
 * which refuses to run in a browser.
 *
 * Without a key the app is fully usable on the mock — that is a supported
 * state, not a degraded one, so this does not warn or throw.
 */
export function createJudge(apiKey: string | undefined): Judge {
  return apiKey === undefined ? createMockJudge() : createJevJudge({ apiKey });
}

export { createJevJudge } from "./jevJudge";
export { createMockJudge } from "./mockJudge";
export type { Judge, Judgment, JudgmentInput, RecentItem } from "./types";
