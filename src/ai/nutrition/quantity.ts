/**
 * Korean quantity parsing.
 *
 * Entirely deterministic — no model is involved and none should be. "두 개"
 * is 2, always, and a language model is the wrong tool for arithmetic the
 * language already settles.
 *
 * Two numeral systems appear in food talk and both are handled:
 *   - native counters, which take an attributive form before a unit
 *     (하나 → 한 개, 둘 → 두 개, 셋 → 세 개)
 *   - digits, usually with a metric unit (200ml, 1개)
 *
 * Fractions show up constantly in this app because people leave food:
 * 반 공기, 절반, 한 그릇 반.
 */

/** Counters and measures that can follow a number. */
export const UNITS = [
  // counted items
  "개",
  "알",
  "쪽",
  "조각",
  "장",
  "줄",
  "판",
  "마리",
  // vessels
  "공기",
  "그릇",
  "잔",
  "컵",
  "대접",
  "스푼",
  "숟가락",
  // packaging
  "팩",
  "병",
  "캔",
  "봉지",
  "봉",
  "포",
  // portions
  "인분",
  "접시",
  // metric
  "ml",
  "mL",
  "리터",
  "g",
  "kg",
  "그램",
] as const;

export type Unit = (typeof UNITS)[number];

/** Standalone native numerals: "하나 먹었어". */
const STANDALONE_NUMERALS: Record<string, number> = {
  하나: 1,
  둘: 2,
  셋: 3,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};

/** Attributive native numerals, used only before a unit: "두 개". */
const ATTRIBUTIVE_NUMERALS: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};

const HALF_WORDS: Record<string, number> = {
  반: 0.5,
  절반: 0.5,
};

export type Quantity = {
  /** 1 for 하나, 0.5 for 반, 200 for 200ml. */
  value: number;
  /** The counter as it was said, or null when none was given. */
  unit: Unit | null;
  /** What the user wrote, kept for display: "한 공기", "반", "200ml". */
  text: string;
  /** True when nothing was stated and one serving was assumed. */
  assumed: boolean;
};

export type QuantityMatch = {
  quantity: Quantity;
  /** Index where the quantity expression starts in the input. */
  start: number;
};

// Every unit is plain Hangul or ASCII letters, so none of them needs escaping.
// Longest first, so "그릇" is tried before a hypothetical prefix of it.
const unitPattern = [...UNITS]
  .sort((a, b) => b.length - a.length)
  .join("|");

const numeralPattern = Object.keys(ATTRIBUTIVE_NUMERALS)
  .concat(Object.keys(STANDALONE_NUMERALS))
  .sort((a, b) => b.length - a.length)
  .join("|");

const halfPattern = Object.keys(HALF_WORDS).join("|");

/**
 * "반 그릇만", "두 개만", "반만": 만 ("only") after an amount is how people
 * say they ate less than they might have. It stresses the amount without
 * changing it, so it is read past — and left out of the text kept for
 * display, where "반 그릇" is the amount.
 */
const ONLY = "(?:[ ]?만)?";

function spoken(matched: string): string {
  return matched.trim().replace(/[ ]?만$/, "");
}

/**
 * "1/2", "2분의 1": a written fraction. Only a proper one with a small
 * denominator is an amount — "3/4개" is, "10/3" is a date and "11/2" is not
 * anything this app should guess at.
 */
const MAX_DENOMINATOR = 10;

function fraction(numerator: string | undefined, denominator: string | undefined): number | null {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isInteger(top) || !Number.isInteger(bottom)) return null;
  if (top < 1 || bottom > MAX_DENOMINATOR || top >= bottom) return null;
  return top / bottom;
}

/**
 * A digit is only an amount on its own. One that ends a slash or a decimal
 * belongs to something longer ("2+1" is an offer): without this, "바나나 1/2개" was read as
 * "2개" of a food called "바나나 1/" (2026-10-06 feedback).
 */
const NOT_AFTER_NUMBER = "(?<![0-9./+])";

const SLASH_FRACTION = "([0-9]+)[ ]*/[ ]*([0-9]+)";
const KOREAN_FRACTION = "([0-9]+)[ ]?분의[ ]?([0-9]+)";

/**
 * Ordered by specificity: "한 그릇 반" has to be tried before "한 그릇",
 * or the trailing 반 is silently dropped and 1.5 becomes 1.
 */
const PATTERNS: { re: RegExp; read: (m: RegExpMatchArray) => Quantity | null }[] = [
  // 한 그릇 반, 두 공기 반
  {
    re: new RegExp(
      `(${numeralPattern})[ ]*(${unitPattern})[ ]*(${halfPattern})${ONLY}[ ]*$`,
    ),
    read: (m) => {
      const whole = readNumeral(m[1]);
      if (whole === null) return null;
      return {
        value: whole + 0.5,
        unit: asUnit(m[2]),
        text: spoken(m[0]),
        assumed: false,
      };
    },
  },
  // 1/2개, 1/3 공기 — before the digit patterns, which would take the 2
  {
    re: new RegExp(`${NOT_AFTER_NUMBER}${SLASH_FRACTION}[ ]*(${unitPattern})${ONLY}[ ]*$`),
    read: (m) => {
      const value = fraction(m[1], m[2]);
      if (value === null) return null;
      return { value, unit: asUnit(m[3]), text: spoken(m[0]), assumed: false };
    },
  },
  // 1/2 — of whatever one serving is
  {
    re: new RegExp(`${NOT_AFTER_NUMBER}${SLASH_FRACTION}${ONLY}[ ]*$`),
    read: (m) => {
      const value = fraction(m[1], m[2]);
      if (value === null) return null;
      return { value, unit: null, text: spoken(m[0]), assumed: false };
    },
  },
  // 2분의 1 공기 — the denominator comes first in Korean
  {
    re: new RegExp(`${NOT_AFTER_NUMBER}${KOREAN_FRACTION}[ ]*(${unitPattern})${ONLY}[ ]*$`),
    read: (m) => {
      const value = fraction(m[2], m[1]);
      if (value === null) return null;
      return { value, unit: asUnit(m[3]), text: spoken(m[0]), assumed: false };
    },
  },
  // 2분의 1
  {
    re: new RegExp(`${NOT_AFTER_NUMBER}${KOREAN_FRACTION}${ONLY}[ ]*$`),
    read: (m) => {
      const value = fraction(m[2], m[1]);
      if (value === null) return null;
      return { value, unit: null, text: spoken(m[0]), assumed: false };
    },
  },
  // 1.5공기, 200ml, 2개
  {
    re: new RegExp(`${NOT_AFTER_NUMBER}([0-9]+(?:[.][0-9]+)?)[ ]*(${unitPattern})${ONLY}[ ]*$`),
    read: (m) => ({
      value: Number(m[1]),
      unit: asUnit(m[2]),
      text: spoken(m[0]),
      assumed: false,
    }),
  },
  // 반 공기, 절반 그릇
  {
    re: new RegExp(`(${halfPattern})[ ]*(${unitPattern})${ONLY}[ ]*$`),
    read: (m) => ({
      value: 0.5,
      unit: asUnit(m[2]),
      text: spoken(m[0]),
      assumed: false,
    }),
  },
  // 한 공기, 두 개, 세개, 한잔
  {
    re: new RegExp(`(${numeralPattern})[ ]*(${unitPattern})${ONLY}[ ]*$`),
    read: (m) => {
      const value = readNumeral(m[1]);
      if (value === null) return null;
      return {
        value,
        unit: asUnit(m[2]),
        text: spoken(m[0]),
        assumed: false,
      };
    },
  },
  // 하나, 둘, 셋 — a bare count with no counter
  {
    re: new RegExp(`(${Object.keys(STANDALONE_NUMERALS).join("|")})${ONLY}[ ]*$`),
    read: (m) => {
      const value = m[1] === undefined ? undefined : STANDALONE_NUMERALS[m[1]];
      if (value === undefined) return null;
      return { value, unit: null, text: spoken(m[0]), assumed: false };
    },
  },
  // 반, 절반 — "아까 밥은 반만"
  {
    re: new RegExp(`(${halfPattern})${ONLY}[ ]*$`),
    read: (m) => ({ value: 0.5, unit: null, text: spoken(m[0]), assumed: false }),
  },
  // 2, 3 — a bare digit
  {
    re: new RegExp(`${NOT_AFTER_NUMBER}([0-9]+(?:[.][0-9]+)?)[ ]*$`),
    read: (m) => ({
      value: Number(m[1]),
      unit: null,
      text: spoken(m[0]),
      assumed: false,
    }),
  },
];

function readNumeral(token: string | undefined): number | null {
  if (token === undefined) return null;
  return ATTRIBUTIVE_NUMERALS[token] ?? STANDALONE_NUMERALS[token] ?? null;
}

function asUnit(token: string | undefined): Unit | null {
  if (token === undefined) return null;
  return (UNITS as readonly string[]).includes(token) ? (token as Unit) : null;
}

/** One serving, when the sentence never said how much. */
export function assumedQuantity(): Quantity {
  return { value: 1, unit: null, text: "", assumed: true };
}

/**
 * Collapses every run of whitespace to one space, so the patterns below only
 * ever have to allow for a plain space. Mobile keyboards produce non-breaking
 * spaces often enough to matter.
 */
export function normalizeSpacing(text: string): string {
  return text.replace(/[\s 　]+/g, " ").trim();
}

/**
 * Reads a string that is *only* an amount: "200ml", "210g", "한 공기".
 *
 * Deliberately separate from `parseTrailingQuantity`, which refuses exactly
 * this input. Inside a sentence, a phrase that is nothing but a quantity has
 * no food name left in it and so is not a quantity at all — "하나" on its own
 * is the thing being talked about. But when the app has just asked "how much
 * of it?", the food is already settled and the whole answer is the amount.
 * Same patterns, opposite assumption about what the caller already knows.
 */
export function parseAmountOnly(text: string): Quantity | null {
  const trimmed = normalizeSpacing(text);
  if (trimmed.length === 0) return null;

  for (const { re, read } of PATTERNS) {
    const match = trimmed.match(re);
    if (match?.index === undefined) continue;

    const quantity = read(match);
    if (quantity === null) continue;

    // The amount has to account for the whole answer. "커피 200ml" would
    // leave "커피" over, which means this was not a bare amount and the
    // caller should not treat it as one.
    if (trimmed.slice(0, match.index).trim().length > 0) return null;

    return quantity;
  }

  return null;
}

/**
 * Reads the reply to "얼마나 드셨어요?".
 *
 * `parseAmountOnly` with the endings an answer picks up: "반 그릇이요",
 * "200ml 정도요", "두 개요.". Returns null for anything that is not an
 * amount, and the caller treats it as a new sentence rather than a failed
 * answer — the same rule as the calorie question, because someone who types
 * "김밥 먹었어" here has moved on.
 */
export function readAmountAnswer(message: string): Quantity | null {
  const text = normalizeSpacing(message)
    .replace(/[.!?~]+$/, "")
    .replace(/[ ]?(?:정도|쯤)?[ ]?(?:이에요|예요|이요|요)?$/, "");
  return parseAmountOnly(text);
}

/**
 * Finds a quantity at the *end* of a phrase, which is where Korean puts it.
 * Returns null when there is none — the caller decides whether to assume one.
 */
export function parseTrailingQuantity(phrase: string): QuantityMatch | null {
  const trimmed = normalizeSpacing(phrase);

  for (const { re, read } of PATTERNS) {
    const match = trimmed.match(re);
    if (match?.index === undefined) continue;

    const quantity = read(match);
    if (quantity === null) continue;

    // A quantity that swallowed the whole phrase left no food name behind,
    // so it is not a quantity — it is the thing being talked about.
    if (trimmed.slice(0, match.index).trim().length === 0) return null;

    return { quantity, start: match.index };
  }

  return null;
}
