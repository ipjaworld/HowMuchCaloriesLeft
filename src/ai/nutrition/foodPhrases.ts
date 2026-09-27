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
 *
 * The space is not enough for 과 and 와 at the *end* of a word: "사과 반 개"
 * used to split into "사" and "반 개", and "사" then prefix-matched 사과 as a
 * whole apple — a silent wrong figure. Grammar settles it, so no word list is
 * needed: the conjunction is 과 after a final consonant (밥과) and 와 after a
 * vowel (커피와). 사 ends in a vowel, so the 과 in 사과 cannot be "and".
 */
const SEPARATOR = /(이랑|랑|하고|그리고|및|와|과|에(?!서))[ ]+|[,][ ]*/g;

/** Whether a Hangul syllable carries a final consonant (받침). */
function hasFinalConsonant(syllable: string): boolean | null {
  const code = syllable.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

/** True when a 과/와 at `index` can grammatically be the conjunction. */
function isConjunctionHere(text: string, index: number, particle: "과" | "와"): boolean {
  const final = hasFinalConsonant(text[index - 1] ?? "");
  if (final === null) return false;
  return particle === "과" ? final : !final;
}

function splitPhrases(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SEPARATOR)) {
    const word = match[1];
    if ((word === "과" || word === "와") && !isConjunctionHere(text, match.index, word)) {
      continue;
    }
    segments.push(text.slice(start, match.index));
    start = match.index + match[0].length;
  }
  segments.push(text.slice(start));
  return segments;
}

/**
 * The eating verb as a whole last word, however it is inflected or typed:
 * 먹었엉, 먹었당, 먹었다니까, 마셨음ㅋㅋ. A list of endings can never keep up
 * with how people type, and missing one is not harmless — "바나나 2개
 * 먹었엉" kept "2개 먹었엉" inside the name, lost the count, and was stored
 * as one banana. A word that *starts* with the verb stem is the verb.
 */
const EATING_VERB_WORD =
  /(?:^|\s)(?:먹|마셨|마시|마심|마셔|드셨|드심|드시)[가-힣]*[\s.,!?~ㅋㅎㅠㅜ^]*$/;

/** Removes a trailing eating verb, in any inflection. */
export function stripEatingVerb(text: string): string {
  return text.replace(EATING_VERB_WORD, "").trimEnd();
}

function stripVerbEnding(text: string): string {
  for (const ending of VERB_ENDINGS) {
    if (text.endsWith(ending)) {
      return text.slice(0, -ending.length).trimEnd();
    }
  }
  return stripEatingVerb(text);
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
  return splitFoodSegments(sentence)
    .map(toFoodPhrase)
    .filter((phrase): phrase is ParsedFoodPhrase => phrase !== null);
}

/**
 * The sentence cut into one slice per food, before any amount is read.
 *
 * Exposed because a slice can carry something a food phrase has no room for:
 * "샌드위치 450kcal" states its own calories, and the caller has to see that
 * before the "450kcal" is read — or dropped — as an amount.
 */
export function splitFoodSegments(sentence: string): string[] {
  const normalized = stripLeadingMarkers(
    stripVerbEnding(normalizeSpacing(sentence)),
  );
  if (normalized.length === 0) return [];

  return splitPhrases(normalized)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function toFoodPhrase(segment: string): ParsedFoodPhrase | null {
  const match = parseTrailingQuantity(segment);

  if (match === null) {
    return { name: segment, quantity: assumedQuantity(), sourceText: segment };
  }

  const name = segment.slice(0, match.start).trim();
  if (name.length === 0) return null;

  return { name, quantity: match.quantity, sourceText: segment };
}
