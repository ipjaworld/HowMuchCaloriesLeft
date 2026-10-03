import { describedFoodWords } from "./modifierPolicy";
import { normalizeSpacing, parseAmountOnly } from "./quantity";

/**
 * Calories the user said out loud: "샌드위치 450kcal", "대충 600칼로리 먹었어".
 *
 * A figure the user gives is the best one there is — better than the dataset,
 * which only knows a typical serving of something like it. So it is read here,
 * by pattern, and stored as said. No model reads the number: the user already
 * wrote it down, and the only way to get it wrong is to let something
 * reinterpret it.
 *
 * Only a number *with* a calorie unit counts inside a sentence. "간식 한 300"
 * could be grams as easily as kcal, and guessing which would be the invented
 * figure this app exists not to produce.
 */

/** What a stated figure is stored under when the sentence names no food. */
export const UNNAMED_FOOD_LABEL = "직접 입력";

// 칼로리 is tried before 칼, and 칼 is kept off 칼국수.
const CALORIE_PATTERN =
  /(\d{1,3}(?:,\d{3})+|\d+)[ ]?(?:kcal|킬로칼로리|키로칼로리|칼로리|cal(?![a-z])|칼(?!국))/gi;

export type StatedCalories = {
  calories: number;
  /** The food the figure is for, when the words around it name one. */
  label: string | null;
};

function toNumber(digits: string): number {
  return Number(digits.replace(/,/g, ""));
}

/**
 * Finds a stated figure in one food segment.
 *
 * When there are two, the last one wins: "600칼로리 말고 800칼로리" is a
 * correction, and the figure after it is the one meant.
 */
export function findStatedCalories(segment: string): StatedCalories | null {
  const text = normalizeSpacing(segment);
  const matches = [...text.matchAll(CALORIE_PATTERN)];
  const last = matches.at(-1);
  if (last === undefined) return null;

  const calories = toNumber(last[1] ?? "");
  if (!Number.isFinite(calories)) return null;

  const before = text.slice(0, last.index);
  // Text after the figure names a food only in "450kcal짜리 샌드위치". In
  // "720칼로리였어" it is the rest of the verb.
  const after = text.slice(last.index + last[0].length).match(/^[ ]?짜리[ ]?(.*)$/);

  return {
    calories,
    label: cleanFoodLabel(before) ?? (after === null ? null : cleanFoodLabel(after[1] ?? "")),
  };
}

/** Whether the sentence says its figure covers everything in it. */
export function statesATotal(sentence: string): boolean {
  return /(총|합쳐서|합해서|통틀어|다 해서|전부 해서|전부|모두)/.test(sentence);
}

/**
 * Words that frame a figure without naming a food: hedges, pointers, and the
 * verbs people wrap around them.
 */
const FILLER_WORDS = new Set([
  "음",
  "한",
  "약",
  "대략",
  "대충",
  "거의",
  "그냥",
  "뭐",
  "아마",
  "총",
  "전부",
  "다",
  "모두",
  "합쳐서",
  "합해서",
  "통틀어",
  "이거",
  "그거",
  "저거",
  "이건",
  "그건",
  "거",
  "것",
  "먹은",
  "마신",
  "먹었는데",
  "먹었고",
  "마셨는데",
  "마셨고",
  "정도",
  "쯤",
  "짜리",
  "많이",
  "조금",
  "좀",
  "너무",
]);

/**
 * Endings that mark a clause rather than a food name. A word list of foods
 * would never be complete, but the ways a sentence carries on after a noun
 * are few: 같고, 했는데, 해서.
 */
const CLAUSE_ENDING = /(겠어|겠다|같고|하고|했고|는데|은데|해서|어서|아서|지만|거든|듯|었다|았다|했다|먹고|먹었|마셨)$/;

/**
 * The food name in a scrap of sentence, or null when the scrap is talk
 * rather than a name.
 *
 * Deliberately strict. The label is what the list shows, and "직접 입력" is a
 * far better row than "이건 데이터베이스과 없을거 같고". At most two words
 * survive, which covers "회사 도시락" and not much that is not a name.
 */
export function cleanFoodLabel(text: string): string | null {
  const said = normalizeSpacing(text.replace(/[.,!?~…"'()]/g, " "))
    .split(" ")
    .filter((word) => word.length > 0 && !FILLER_WORDS.has(word));

  // Longer than two words only when every word in front of the food says
  // something about it — "잘 구운 계란", "따뜻한 설탕 넣은 커피" — after the
  // narration in front is left out ("친구가 사준 구운 계란" → 구운 계란).
  const words = said.length > 2 ? describedFoodWords(said) : said;
  if (words === null || words.length === 0 || words.length > 4) return null;

  const lastIndex = words.length - 1;
  const last = words[lastIndex] ?? "";
  // "도시락인데", "라면은" — the particle is not part of the name.
  const stripped = last.replace(/(이었는데|였는데|인데|은|는)$/, "");
  if (stripped.length === 0) return null;
  words[lastIndex] = stripped;

  // In a described food every word in front was already read as describing
  // it (구워온, 넣어서), so only the food itself is checked for a clause ending.
  if ((said.length > 2 ? words.slice(-1) : words).some((word) => CLAUSE_ENDING.test(word))) return null;
  if (!words.every((word) => /^[가-힣a-zA-Z0-9]+$/.test(word))) return null;

  const label = words.join(" ");
  return label.replace(/\s+/g, "").length <= 15 ? label : null;
}

export type CalorieAnswer =
  | { status: "calories"; calories: number }
  /** Only an amount, in a unit that is not calories: "200g", "한 공기". */
  | { status: "wrong_unit" };

/**
 * Reads the reply to "대략 몇 kcal였나요?".
 *
 * Here a bare number *is* calories — the question just asked for them — so
 * "600", "한 600", "대충 600 정도요" all count. Anything that is not a number
 * returns null, and the caller treats it as a new sentence rather than a
 * failed answer: someone who types "김밥 먹었어" has moved on.
 */
export function readCalorieAnswer(message: string): CalorieAnswer | null {
  const stated = findStatedCalories(message);
  if (stated !== null) return { status: "calories", calories: stated.calories };

  const text = normalizeSpacing(message).replace(/[.!~]+$/, "");
  const bare = text.match(
    /^(?:(?:한|약|대략|대충|아마|거의|음)[ ]?)*(\d{1,3}(?:,\d{3})+|\d+)[ ]?(?:정도|쯤)?(?:요|이요|이에요|예요)?$/,
  );
  if (bare !== null) return { status: "calories", calories: toNumber(bare[1] ?? "") };

  if (parseAmountOnly(text) !== null) return { status: "wrong_unit" };
  return null;
}
