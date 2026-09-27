import { stripEatingVerb, toFoodPhrase } from "@/ai/nutrition/foodPhrases";
import { normalizeSpacing, parseAmountOnly } from "@/ai/nutrition/quantity";

/**
 * Reading a correction: "떠먹는 요거트를 그릭 요거트로 바꾸고 싶어".
 *
 * The judge already knows *which* entry a correction is about — it picked
 * 떠먹는 요거트 at 1.00 in every measured wording. What it does not say is
 * what the entry should become, and the add pipeline's phrase parser was
 * never built for correction grammar: it read the whole sentence above as
 * one food name. This module turns the sentence into the plain phrase the
 * add pipeline does understand — "그릭 요거트 200g" — and nothing more. The
 * lookup, the asking and the storing are all the existing ones.
 *
 * Fixed patterns, like the rest of the phrase handling: a correction is said
 * in a handful of shapes, and a pattern cannot misread one the way a model
 * could invent one.
 */

/**
 * Request and copula endings that carry no food: 로 바꿔줘, 였어, 이야.
 * 해 counts only after 로/으로 ("1공기로 해줘"), and bare 야 is not an
 * ending here — 파파야 must stay 파파야.
 */
const TRAILING =
  /\s*(?:(?:(?:으로|로)\s*)?(?:바꾸고\s*싶어요?|바꿔\s*주세요|바꿔\s*줘|바꿔요|바꿔|바꿀래|바꾸자|수정해\s*줘|수정해|고쳐\s*줘|고쳐|변경해\s*줘|변경해)|(?:으로|로)\s*(?:해\s*줘|해요|해|할래))?\s*(?:이었어요|였어요|이었어|였어|이었음|였음|이었다|였다|이에요|예요|이야|입니다)?[.!~]*$/;

/** "A 말고 B", "A 아니고 B", "A 아니라 B". */
const REPLACEMENT_MARKER = /\s*(?:말고|아니고|아니라)\s+/;

/** "A를 B로 바꿔" — the object particle, trusted only when A is the entry. */
const OBJECT_MARKER = /(?:을|를)\s+/;

/** "A는 B였어" — the topic particle, trusted only when A is the entry. */
const TOPIC_MARKER = /(?:은|는)\s+/;

const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * Whether a phrase names the entry being corrected. Two characters at least:
 * "삶은 달걀" must not split after 삶 and call 삶 the old food.
 */
function namesTarget(phrase: string, targetName: string): boolean {
  const said = squash(phrase).replace(/^(아까|방금|오늘|그|이)/, "");
  const name = squash(targetName);
  if (said.length < 2) return false;
  return name.includes(said) || said.includes(name);
}

export type CorrectionParts = {
  /** What the sentence says the entry was, when it says so. */
  previous: string | null;
  /** What it should be — a food, an amount, or both. */
  next: string;
};

/** Splits a correction into what was logged and what it should be. */
export function splitCorrection(message: string, targetName: string | null): CorrectionParts {
  // "2개 먹었다니까?" corrects the amount; the verb and its insistence carry
  // nothing, and neither does a "라니까" on a bare amount.
  const text = stripEatingVerb(normalizeSpacing(message))
    .replace(/(?:이라니까|라니까|이라고|라고)[?!.~]*$/, "")
    .replace(TRAILING, "")
    .trim();

  const replacement = text.split(REPLACEMENT_MARKER);
  if (replacement.length === 2 && replacement[1] !== "") {
    return { previous: replacement[0] ?? null, next: replacement[1] ?? "" };
  }

  if (targetName !== null) {
    for (const marker of [OBJECT_MARKER, TOPIC_MARKER]) {
      const match = marker.exec(text);
      if (match === null) continue;
      const previous = text.slice(0, match.index);
      const next = text.slice(match.index + match[0].length);
      if (next !== "" && namesTarget(previous, targetName)) return { previous, next };
    }
  }

  return { previous: null, next: text };
}

/** Numbers without a unit, as the correction states them: "700 아니고 550". */
const BARE_NUMBER = /^(?:한|약|대충)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(?:kcal|칼로리|칼)?$/i;

export type CorrectionTarget = {
  name: string;
  amount?: string;
  calories: number;
  calorieSource?: "dataset" | "user";
};

export type Correction =
  /** A phrase for the ordinary add pipeline to resolve. */
  | { kind: "phrase"; text: string }
  /** "아까 700 아니고 550이야": a figure the user states, stored as said. */
  | { kind: "calories"; calories: number };

/**
 * What to look up for a correction of `target`.
 *
 *   떠먹는 요거트를 그릭 요거트로 바꾸고 싶어  → "그릭 요거트 200g"  (amount kept)
 *   쌀밥 2공기 말고 1공기                      → "쌀밥 1공기"        (food kept)
 *   아까 사과 두 개였어                         → "아까 사과 두 개"
 *   아까 700 아니고 550이야                     → 550 kcal, as said
 *
 * The amount carries over only when the new side names a food and no
 * amount: someone who swaps the yoghurt still ate the same 200 g.
 */
export function correctionFor(message: string, target: CorrectionTarget): Correction {
  const { previous, next } = splitCorrection(message, target.name);

  // A bare number is calories only when the other side is the entry's own
  // figure, or a bare number too — "700 아니고 550". Alone, "550이야" could
  // as easily be grams.
  const nextNumber = BARE_NUMBER.exec(next);
  if (nextNumber !== null && previous !== null) {
    const previousNumber = BARE_NUMBER.exec(previous.replace(/^(아까|방금)\s*/, ""));
    if (previousNumber !== null) {
      return { kind: "calories", calories: Number((nextNumber[1] ?? "").replace(/,/g, "")) };
    }
  }

  // An entry the user priced has no grams behind it, so a lone number
  // correcting it can only be calories: "550이야".
  if (nextNumber !== null && target.calorieSource === "user") {
    return { kind: "calories", calories: Number((nextNumber[1] ?? "").replace(/,/g, "")) };
  }

  if (parseAmountOnly(next) !== null) {
    return { kind: "phrase", text: `${target.name} ${next}` };
  }

  const phrase = toFoodPhrase(next);
  if (phrase !== null && phrase.quantity.assumed && target.amount !== undefined && previous !== null) {
    return { kind: "phrase", text: `${next} ${target.amount}` };
  }

  return { kind: "phrase", text: next };
}
