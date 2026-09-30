import { assumedQuantity, normalizeSpacing, parseAmountOnly, parseTrailingQuantity, type Quantity } from "./quantity";
import { findStatedCalories } from "./statedCalories";

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

/**
 * "점심은 김밥으로 했어": 하다 standing in for the eating verb. Only as a word
 * of its own — "운동했어" is a different verb, not this one.
 */
const LIGHT_VERBS = new Set(["했어", "했어요"]);

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

/** A slice between separators, and the separator that ended it ("," or "이랑"; null for the last). */
type Piece = { text: string; joiner: string | null };

function splitPieces(text: string): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;
  for (const match of text.matchAll(SEPARATOR)) {
    const word = match[1];
    if ((word === "과" || word === "와") && !isConjunctionHere(text, match.index, word)) {
      continue;
    }
    pieces.push({ text: text.slice(start, match.index), joiner: word ?? "," });
    start = match.index + match[0].length;
  }
  pieces.push({ text: text.slice(start), joiner: null });
  return pieces;
}

/**
 * The eating verb as a whole last word, however it is inflected or typed:
 * 먹었엉, 먹었당, 먹었다니까, 마셨음ㅋㅋ. A list of endings can never keep up
 * with how people type, and missing one is not harmless — "바나나 2개
 * 먹었엉" kept "2개 먹었엉" inside the name, lost the count, and was stored
 * as one banana. A word that *starts* with the verb stem is the verb.
 */
const EATING_STEMS = "먹|마셨|마시|마심|마셔|드셨|드심|드시";

/**
 * The one definition of the eating verb. The end of a sentence, a clause
 * inside it, and the correction reader in `correction.ts` all ask "is this
 * the verb?" of these three patterns and nothing else.
 */
const EATING_VERB_WORD = new RegExp(
  `(?:^|\\s)(?:${EATING_STEMS})[가-힣]*[\\s.,!?~ㅋㅎㅠㅜ^]*$`,
);

/** A word that *is* the verb, in any form: 먹고, 마셨는데, 먹으려다, 먹었엉. */
const EATING_STEM = new RegExp(`^(?:${EATING_STEMS})`);

/**
 * The verb typed onto the end of another word: "김밥먹었어" → 김밥,
 * "시켜먹었어" → 시켜. Only finished forms, and 먹 only with an inflection
 * after it, so 먹태 and 초코마시멜로 stay food.
 */
const ATTACHED_EATING_VERB =
  /^(.+?)(?:먹(?:었|엇|음|어)|마셨|마심|마셔|드셨|드심)[가-힣]*[.,!?~ㅋㅎㅠㅜ^]*$/;

/** Removes a trailing eating verb, in any inflection. */
export function stripEatingVerb(text: string): string {
  return text.replace(EATING_VERB_WORD, "").trimEnd();
}

/**
 * The words of a clause without its final eating verb, or null when the
 * clause does not end in one.
 */
function withoutFinalVerb(words: string[]): string[] | null {
  const last = words.at(-1);
  if (last === undefined) return null;
  if (EATING_STEM.test(last)) return words.slice(0, -1);
  const attached = ATTACHED_EATING_VERB.exec(last)?.[1];
  if (attached !== undefined) return [...words.slice(0, -1), attached];
  return null;
}

/** The eating verb, or a light 했어 standing in for it, taken off the end. */
function stripVerbEnding(text: string): string {
  const words = text.split(" ").filter((word) => word.length > 0);
  if (LIGHT_VERBS.has(words.at(-1) ?? "")) return words.slice(0, -1).join(" ");
  return (withoutFinalVerb(words) ?? words).join(" ");
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
  return segmentFoods(sentence).map((segment) => segment.text);
}

/** One food slice, and which clause of the sentence it came from. */
export type FoodSegment = {
  text: string;
  clause: number;
  /**
   * The sentence says some of this was left, in a way that cannot be
   * subtracted — "밥은 반 남겼어" of a 비빔밥, "조금 남겼어". The amount it
   * carries is not what was eaten, and must not be stored as if it were.
   */
  amountUnresolved?: true;
};

/**
 * The sentence cut into food slices, clause by clause.
 *
 * A sentence that states calories keeps the original single-clause reading:
 * "김치찌개랑 밥 합쳐서 800칼로리" is a total over everything in it, and
 * cutting at 합쳐서 would lose the foods it totals.
 */
export function segmentFoods(sentence: string): FoodSegment[] {
  const text = normalizeSpacing(sentence);
  if (findStatedCalories(text) !== null) {
    return singleClauseSegments(text).map((segment) => ({ text: segment, clause: 0 }));
  }

  const segments: FoodSegment[] = [];
  let previous: FoodSegment[] = [];

  for (const [index, clause] of splitClauses(text).entries()) {
    if (!clause.eaten) continue;

    // Story around the food ("기분이 안좋아서 떡볶이를") is left in place.
    // Deciding which words are story is a judgment about meaning, and this
    // parser once made it by cutting everything before the last connective —
    // which cut eaten foods too. The matcher already takes only a food that
    // ends its phrase; whatever it cannot place is asked about, not dropped.
    const body = stripLeadingMarkers(clause.words.join(" "));
    if (body.length === 0) continue;

    // "김밥 한 줄 먹었는데 반 줄만 먹은 거였어": a clause that is only an
    // amount corrects the one food before it. With several foods before it,
    // which one it means is not said — so it is left out rather than guessed.
    // "라면 먹었는데 반은 남겼어": what was eaten is what was served less
    // what was left, when both are amounts of the one food before it.
    // Anything vaguer ("조금 남겼어") leaves the food as it was said.
    if (clause.leftover === true) {
      const left = parseAmountOnly(body.replace(/(?:은|는|을|를|이|가)$/, ""));
      const [only] = previous;
      const phrase = only === undefined ? null : toFoodPhrase(only.text);
      if (left !== null && previous.length === 1 && only !== undefined && phrase !== null) {
        const served = phrase.quantity;
        const eaten = (served.assumed ? 1 : served.value) - left.value;
        if (eaten > 0 && (left.unit === null || left.unit === served.unit)) {
          const unit = served.assumed ? "" : served.unit ?? "";
          only.text = `${phrase.name} ${eaten === 0.5 && unit === "" ? "반" : `${eaten}${unit}`}`;
          continue;
        }
      }
      // Something was left and the arithmetic cannot say how much was
      // eaten: which food, or which part of it, or how much, is not an
      // amount of the food as served. Storing the amount as said would
      // count what was left as eaten, so every food it could be about is
      // marked, and the caller asks instead of recording.
      for (const food of previous) food.amountUnresolved = true;
      continue;
    }

    const amount = parseAmountOnly(body);
    if (amount !== null) {
      const [only] = previous;
      const phrase = only === undefined ? null : toFoodPhrase(only.text);
      if (previous.length === 1 && only !== undefined && phrase !== null) {
        only.text = `${phrase.name} ${body}`;
      }
      continue;
    }

    const kept = splitPieces(body)
      .filter((piece) => !isContext(piece))
      .map((piece) => piece.text.trim())
      .filter((piece) => piece.length > 0)
      .map((piece) => ({ text: piece, clause: index }));
    segments.push(...kept);
    if (kept.length > 0) previous = kept;
  }

  return segments;
}

/** The reading every sentence got before clauses: one clause, verb and framing stripped. */
function singleClauseSegments(text: string): string[] {
  const normalized = stripLeadingMarkers(stripVerbEnding(text));
  if (normalized.length === 0) return [];
  return splitPieces(normalized)
    .map((piece) => piece.text.trim())
    .filter((piece) => piece.length > 0);
}

// ── Clauses ─────────────────────────────────────────────────────────────

type Clause = {
  words: string[];
  eaten: boolean;
  /** "반은 남겼어": the words are an amount *not* eaten. */
  leftover?: boolean;
};

/** Words after the eating verb that do not change it: "먹은 거였어", "먹은 거야". */
const AFTER_VERB = /^(?:거였어|거야|거예요|건데|거였음|것|거)[.!?~]*$/;

/** Said between a food and the eating verb, about how it was got: 사, 시켜, 데워. */
const SERVING_VERBS = new Set([
  "사", "사서", "사다", "시켜", "시켜서", "배달시켜", "포장해", "포장해서",
  "해", "해서", "데워", "데워서", "끓여", "끓여서", "구워", "구워서",
]);

/** A clause-final desire or intent: 먹고 싶다, 먹을까, 마실래, 먹어야지. */
function isIntentOnly(words: string[]): boolean {
  const last = words.at(-1) ?? "";
  const before = words.at(-2) ?? "";
  if (/^(?:먹|마시)고싶/.test(last)) return true;
  if (/^싶/.test(last) && /^(?:먹|마시)고$/.test(before)) return true;
  return /^(?:먹을까|마실까|먹을래|마실래|먹어야지|마셔야지|먹으려고|마시려고)/.test(last);
}

/**
 * Splits a sentence at the verbs inside it.
 *
 * Each clause records whether its food was eaten. "라면 먹고 커피 마셨어" is
 * two eaten clauses; in "라면 안 먹고 김밥 먹었어", "떡볶이 먹으려다 …",
 * "짜장면 먹으려고 했는데 …", "치킨 먹고 싶었는데 …", "사과 말고 …" and
 * "라면 대신 …" the first one was not. The last clause is judged by how the
 * sentence ends: an eating verb, a verbless list ("바나나 하나, 우유 한 컵"),
 * or something else — a wish, a refusal, or a verb that is not eating, none
 * of which reports a meal.
 */
function splitClauses(text: string): Clause[] {
  const words = text.split(" ").filter((word) => word.length > 0);
  const clauses: Clause[] = [];
  let current: string[] = [];

  const close = (eaten: boolean) => {
    clauses.push({ words: current, eaten });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const next = words[i + 1] ?? "";

    if (word === "말고" || word === "대신") {
      close(false);
      continue;
    }

    if (!EATING_STEM.test(word) || i === words.length - 1) {
      current.push(word);
      continue;
    }

    // An eating verb inside the sentence: decide what it says about the
    // clause it ends. Adnominal forms (마시는 요구르트) end nothing.
    const negated = current.at(-1) === "안" || current.at(-1) === "못";
    if (/^(?:먹|마시)고$/.test(word) && /^싶/.test(next)) {
      i += 1; // 먹고 싶었는데
      close(false);
    } else if (/^(?:먹으려고|마시려고)$/.test(word) && /^(?:했|하)/.test(next)) {
      i += 1; // 먹으려고 했는데
      close(false);
    } else if (/^(?:먹으려|마시려|먹을까|마실까|먹고싶|마시고싶)/.test(word)) {
      close(false);
    } else if (/(?:고|고서|는데|은데|지만|다가|어서|니까|더니|고나서)$/.test(word)) {
      if (negated) current.pop();
      close(!negated);
    } else if (/^(?:먹은|마신)$/.test(word) && /^(?:뒤|다음|후|담에|뒤에|다음에|후에)$/.test(next)) {
      i += 1; // 먹은 뒤
      close(true);
    } else if (/(?:는|은|을|신|던)$/.test(word)) {
      // Adnominal — "마시는 요구르트", "먹은 떡볶이" — describes, ends nothing.
      current.push(word);
    } else {
      // A finished form in mid-sentence: "김밥 먹었어요 ㅎㅎ 맛있었다".
      // What came before it was eaten; what follows is a new clause.
      if (negated) current.pop();
      close(!negated);
    }
  }

  // The last clause, by how the sentence ends.
  let tail = current;
  while (tail.length > 0 && AFTER_VERB.test(tail.at(-1) ?? "")) tail = tail.slice(0, -1);
  const last = tail.at(-1) ?? "";

  const verbless = withoutFinalVerb(tail);

  if (/^(?:남겼|남김|남기)/.test(last)) {
    clauses.push({ words: tail.slice(0, -1), eaten: true, leftover: true });
  } else if (isIntentOnly(tail)) {
    clauses.push({ words: [], eaten: false });
  } else if (verbless !== null) {
    const negated = tail.at(-2) === "안" || tail.at(-2) === "못";
    let words = negated ? verbless.slice(0, -1) : verbless;
    // "바나나 사 먹었어", "떡볶이 시켜 먹었어": how it was got, not what.
    while (words.length > 1 && SERVING_VERBS.has(words.at(-1) ?? "")) words = words.slice(0, -1);
    clauses.push({ words, eaten: !negated });
  } else {
    // No eating verb at the end: a verbless list ("바나나 하나, 우유 한
    // 컵"), a light 했어, or a sentence that ends on some other verb. Whether
    // that last kind reports a meal at all is Jev's consumption judgment,
    // made before this runs — not something to guess from the ending here.
    clauses.push({ words: stripVerbEnding(tail.join(" ")).split(" ").filter(Boolean), eaten: true });
  }

  return clauses.filter((clause) => clause.words.length > 0);
}

// ── Context around a food ───────────────────────────────────────────────

/** Who someone ate with: "친구랑", "김 대리랑", "동생이랑". */
const PEOPLE = new Set([
  "친구", "친구들", "동생", "엄마", "아빠", "언니", "오빠", "누나", "형", "가족",
  "남친", "여친", "남자친구", "여자친구", "애인", "남편", "아내", "와이프", "딸", "아들",
  "아이", "애들", "동료", "동료들", "사람들", "선배", "후배", "대리", "과장", "부장",
  "팀장", "차장", "사장", "선생님", "교수님", "할머니", "할아버지", "룸메", "룸메이트",
]);

/** What someone did before eating: "퇴근하고", "운동하고". Only before 하고. */
const ACTIVITIES = new Set([
  "퇴근", "출근", "운동", "헬스", "회의", "야근", "산책", "공부", "수업", "청소",
  "샤워", "등산", "러닝", "요가", "필라테스", "업무", "일", "알바", "미팅", "회식",
  "데이트", "쇼핑", "게임", "수영", "출장", "과제", "빨래", "설거지", "병원", "외출",
]);

/** When: "밤에", "출근길에". Only before 에 — 밤 is also a chestnut. */
const TIMES = new Set([
  "밤", "새벽", "낮", "오전", "오후", "주말", "평일", "아침", "점심", "저녁", "야식",
  "간식", "퇴근후", "퇴근 후", "운동후", "운동 후", "식후",
]);

/**
 * A slice that is framing, not food — by the separator that ended it.
 *
 * "친구랑" is company because 랑 follows a person; "마라탕이랑" is a food
 * because it does not. "밤에" is a time because 에 follows it; "밤이랑
 * 고구마" is two foods. Deciding by the pair keeps an unknown food from
 * being dropped just because its name is also a word for something else.
 * A slice with a 한테 or 에게 in it ("친구한테 사과") is someone being
 * addressed, which no list of foods is.
 */
function isContext(piece: Piece): boolean {
  const words = piece.text.trim().split(" ").filter(Boolean);
  const last = (words.at(-1) ?? "").replace(/(?:님|들)$/, "");
  const whole = piece.text.trim();

  if (words.some((word) => /(?:한테|에게|께)$/.test(word))) return true;
  if (piece.joiner === "이랑" || piece.joiner === "랑" || piece.joiner === "하고" || piece.joiner === "와" || piece.joiner === "과") {
    if (PEOPLE.has(last) || PEOPLE.has(words.at(-1) ?? "")) return true;
  }
  if (piece.joiner === "하고" && ACTIVITIES.has(whole)) return true;
  if (piece.joiner === "에" && (TIMES.has(whole) || whole.endsWith("길"))) return true;
  return false;
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
