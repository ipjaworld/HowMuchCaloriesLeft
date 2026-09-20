import { assumedQuantity, normalizeSpacing, parseTrailingQuantity, type Quantity } from "./quantity";

/**
 * Splits a sentence into the food phrases it mentions.
 *
 * "갈비탕 하나랑 밥 한 공기 먹었어"
 *   → [{ name: "갈비탕", quantity: 1 }, { name: "밥", quantity: 1 공기 }]
 *
 * Deterministic, and deliberately conservative: it recognises the shapes
 * Korean actually uses to list what someone ate, and gives up rather than
 * inventing structure. What it cannot split, the LLM fallback gets — once
 * that exists.
 *
 * Note what this does *not* do: it never decides what a food is worth. The
 * name it returns is the user's own wording, matched against a dataset
 * afterwards.
 */

export type ParsedFoodPhrase = {
  /**
   * The food as the user said it, particles and all — "갈비탕", "밥은".
   * Stripping particles here would be guesswork: 오이 and 포도 end in what
   * look like particles. The matcher tries the variants against real data
   * instead, where the ambiguity can actually be settled.
   */
  name: string;
  quantity: Quantity;
  /** The slice of the sentence this phrase came from. */
  sourceText: string;
};

/** Sentence-final verbs. Removed before anything else is read. */
const VERB_ENDINGS = [
  "먹었어요",
  "먹었습니다",
  "먹었어",
  "먹었다",
  "먹었음",
  "먹었지",
  "먹었네",
  "먹음",
  "먹었",
  "마셨어요",
  "마셨습니다",
  "마셨어",
  "마셨다",
  "마셨음",
  "마심",
  "마셨",
  "드셨어요",
  "했어요",
  "했어",
];

/**
 * Time and place phrases that frame the meal without being part of it.
 * "점심에", "편의점에서", "아까".
 */
const LEADING_MARKERS = [
  /^(오늘|어제|아까|방금|지금|이따|아침|점심|저녁|간식|야식)(에|엔|으로|로|은|는)?[ ]+/,
  /^[가-힣]+에서[ ]+/,
];

/**
 * Conjunctions, each of which must be followed by a space. That space is
 * what keeps 와인 and 과자 from being split on their first syllable.
 * `에` links two foods in one meal ("김치찌개에 공기밥"), but `에서` is a
 * place, so it is excluded.
 */
const SEPARATOR = /(?:이랑|랑|하고|그리고|및|와|과|에(?!서))[ ]+|[,][ ]*/;

function stripVerbEnding(text: string): string {
  for (const ending of VERB_ENDINGS) {
    if (text.endsWith(ending)) {
      return text.slice(0, -ending.length).trimEnd();
    }
  }
  return text;
}

function stripLeadingMarkers(text: string): string {
  let current = text;
  // Repeated because "오늘 점심에 편의점에서" stacks three of them.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const marker of LEADING_MARKERS) {
      const next = current.replace(marker, "");
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return current;
}

export function parseFoodPhrases(sentence: string): ParsedFoodPhrase[] {
  const normalized = stripLeadingMarkers(
    stripVerbEnding(normalizeSpacing(sentence)),
  );
  if (normalized.length === 0) return [];

  return normalized
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(toPhrase)
    .filter((phrase): phrase is ParsedFoodPhrase => phrase !== null);
}

function toPhrase(segment: string): ParsedFoodPhrase | null {
  const match = parseTrailingQuantity(segment);

  if (match === null) {
    return { name: segment, quantity: assumedQuantity(), sourceText: segment };
  }

  const name = segment.slice(0, match.start).trim();
  if (name.length === 0) return null;

  return { name, quantity: match.quantity, sourceText: segment };
}
