import type { RecentItem } from "./types";

/**
 * Deterministic "which entry is this about?" resolution, in code.
 *
 * This lives outside `mockJudge` because it is not a stand-in for Jev — it is
 * a real part of the reference strategy. The Phase 4.5 measurement picked
 * strategy A (Jev decides), but Jev reports its own confidence and the one
 * case it missed on the golden set it also flagged: `referenceConfidence`
 * 0.29, well under the floor. Below that floor `decideCommand` asks this
 * function instead of giving up, which is exactly the deictic case Jev is
 * weakest on and a rule is strongest on ("방금 넣은 거" — the last thing).
 *
 * Keep it a rule. It is not meant to grow into an NLP engine: when it and Jev
 * disagree above the floor, Jev wins.
 */

/** Dropped before deciding whether anything food-like is left. */
const TIME_MARKER_RE = /^(아까|방금|오늘|어제|내일|지금)$/;
const MEAL_TIME_RE = /^(아침|점심|저녁|간식|야식)(에|으로|은|는|엔)$/;

/** Words that mean "the one I just added" rather than naming a food. */
const MOST_RECENT_RE = /방금|마지막|마지막으로/;

/** Trailing particles, so "밥은" can still match the entry named "흰쌀밥". */
const PARTICLE_RE = /(은|는|이|가|을|를|도|만|의|에|과|와|랑)$/;

export const VERB_RE = /(먹었|먹음|마셨|마심|드셨|했어|였어|이야|이었)/;

/** Tokens that might be a food name, once markers and verbs are removed. */
export function foodLikeTokens(message: string): string[] {
  return message
    .split(/\s+/)
    .map((token) => token.replace(/[?!.,]/g, ""))
    .filter((token) => token.length > 0)
    .filter((token) => !TIME_MARKER_RE.test(token))
    .filter((token) => !MEAL_TIME_RE.test(token))
    .filter((token) => !VERB_RE.test(token));
}

/**
 * Every logged item the message could be naming, most recent first.
 *
 * Kept separate from picking a winner because how many matched is itself
 * information. "밥" is inside both 김밥 and 쌀밥, and for a delete that is the
 * difference between removing 322 kcal and 351 kcal — a caller that only
 * receives the winner cannot tell that it was a coin toss.
 */
export function findReferenceMatches(
  message: string,
  recentItems: RecentItem[],
): RecentItem[] {
  const byRecency = recentItems
    .slice()
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt));

  const tokens = foodLikeTokens(message);

  // Single-syllable food words are ordinary in Korean — 밥, 국, 면 — so a
  // one-character token still matches, but only inside the stored name.
  // Matching the other way round needs two characters to stay meaningful.
  const forms = tokens.flatMap((token) => {
    const stripped = token.replace(PARTICLE_RE, "");
    return stripped === token || stripped.length === 0 ? [token] : [token, stripped];
  });

  const matched = byRecency.filter((item) =>
    forms.some(
      (form) =>
        item.name.includes(form) ||
        (form.length >= 2 && form.includes(item.name)),
    ),
  );
  if (matched.length > 0) return matched;

  // "방금 넣은 거 취소해줘" names nothing, but says which one it means.
  if (MOST_RECENT_RE.test(message)) {
    const newest = byRecency[0];
    return newest === undefined ? [] : [newest];
  }

  return [];
}

/**
 * Name match first, then recency. When several entries share the matched
 * text — "밥" is inside both 삼각김밥 and 흰쌀밥 — the most recent one wins,
 * which is what "아까 밥" almost always means.
 *
 * That tiebreak is fine for a correction, which is visible and reversible.
 * A delete asks instead; see `decideCommand`.
 */
export function resolveReferenceByName(
  message: string,
  recentItems: RecentItem[],
): string | null {
  return findReferenceMatches(message, recentItems)[0]?.id ?? null;
}
