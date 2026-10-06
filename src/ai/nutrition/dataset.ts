import { z } from "zod";
import {
  ALL_COOKING_FORMS,
  GENERIC_REPRESENTATIVE_IDS,
  classifyModifier,
  cookingFormsOf,
  nameCarriesMethod,
  type ModifierKind,
} from "./modifierPolicy";
import { parseAmountOnly } from "./quantity";
import type { FoodEntry } from "./types";

/**
 * The local food dataset: its schema, and how a user's wording is matched
 * against it.
 *
 * The dataset itself is built from the MFDS food-nutrition database. This
 * file defines the shape that ingestion has to produce, and validates it on
 * load, so a bad row can never reach the arithmetic.
 */

const servingSchema = z.object({
  unit: z.string().min(1),
  grams: z.number().positive().finite(),
  basis: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("mfds") }),
      z.object({
        kind: z.enum(["reference", "typical"]),
        note: z.string().min(1),
        citation: z.string().min(1),
        measure: z.literal("mL").optional(),
      }),
    ])
    .optional(),
});

export const foodEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  caloriesPer100g: z.number().nonnegative().finite(),
  servings: z.array(servingSchema).min(1).optional(),
  variance: z.literal("high").optional(),
  source: z.string().min(1),
});

export const foodDatasetSchema = z.object({
  version: z.literal(1),
  /** Where the figures came from, for the README and for attribution. */
  source: z.object({
    name: z.string().min(1),
    retrievedAt: z.string().min(1),
    license: z.string().min(1),
  }),
  entries: z.array(foodEntrySchema),
});

export type FoodDataset = z.infer<typeof foodDatasetSchema>;

/** Invalid rows are dropped, not fatal — one bad food should not blank the app. */
export function parseFoodEntries(entries: unknown[]): FoodEntry[] {
  const valid: FoodEntry[] = [];
  for (const entry of entries) {
    const result = foodEntrySchema.safeParse(entry);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

/** Korean particles that can trail a food name in ordinary speech. */
const TRAILING_PARTICLES = ["은", "는", "이", "가", "을", "를", "도", "만", "의"];

/** Spacing is not reliable in Korean food names: 삶은계란 / 삶은 계란. */
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * The forms of a spoken name worth looking up.
 *
 * A particle-stripped variant is only ever a *candidate*: 오이 and 포도 end
 * in what look like 이 and 도, so the dataset gets to decide which form is
 * real rather than this function guessing.
 */
export function nameVariants(spoken: string): string[] {
  const base = squash(spoken);
  const variants = new Set<string>([base]);

  for (const particle of TRAILING_PARTICLES) {
    if (base.length > particle.length && base.endsWith(particle)) {
      variants.add(base.slice(0, -particle.length));
    }
  }

  return [...variants].filter((variant) => variant.length > 0);
}

/** Below this, a match is not worth offering at all. */
export const MIN_MATCH_SCORE = 0.6;

/** Two candidates this close together are not distinguishable. */
const TIE_EPSILON = 0.001;

/**
 * A food named inside a longer phrase — "기분이 안좋아서 떡볶이를" — scores
 * below every whole-phrase match, so it only ever answers when nothing else
 * does.
 */
const EMBEDDED_SCORE = 0.65;

/**
 * What may follow a food name inside the same word: 떡볶이를, 우유랑,
 * 김밥이었어. The *whole* rest of the word has to be one of these. That is
 * what keeps 감자탕 from being 감자 — 탕 is not a particle — and likewise
 * 딸기케이크, 사과주스, 수박바, 순대볶음.
 */
const WORD_FINAL_PARTICLES = new Set([
  "은", "는", "이", "가", "을", "를", "도", "만", "의",
  "랑", "이랑", "하고", "와", "과", "에", "에서", "으로", "로",
  "까지", "부터", "이나", "나", "요", "이요", "은요", "는요", "도요", "만요",
  "이야", "야", "인데", "이었어", "였어", "이었는데", "였는데",
]);

/**
 * Names that are also everyday non-food words. 사과 is an apology as often as
 * an apple — "친구한테 사과하고" once logged a whole apple — and 아아 is a
 * sigh as often as an iced americano. They still match when they are the
 * whole phrase ("사과 하나"); inside a longer one they are never taken as
 * the food.
 */
const HOMOGRAPH_FORMS = new Set(["사과", "아아", "우둔", "백도"]);

type Scored = { entry: FoodEntry; score: number; generic: boolean };

/**
 * How well the whole spoken phrase names this entry.
 *
 * Exact beats a prefix ("짜장" → 짜장면) beats containment ("냉면" → 물냉면).
 * The phrase must be *part of* a name, never the other way round: a name
 * inside the phrase is a different question, answered with word boundaries
 * by `embeddedMentions`.
 *
 * A single syllable is too short to be part of a name safely — 김 is inside
 * 김밥 and 김치찌개, 회 inside 연어회, 떡 inside 떡국 — so it only matches as
 * the *head* of a name, the last syllable a Korean compound names its kind
 * by (쌀밥 and 현미밥 are both 밥). That is `generic`, and a generic match
 * may only ever ask, never answer on its own.
 */
function scoreEntry(
  entry: FoodEntry,
  variants: string[],
): { score: number; generic: boolean } {
  const names = [entry.name, ...(entry.aliases ?? [])].map(squash);
  let best = 0;
  let generic = false;

  const raise = (score: number, isGeneric: boolean) => {
    if (score > best) {
      best = score;
      generic = isGeneric;
    }
  };

  for (const variant of variants) {
    // An exact hit on the first variant is the user's own wording; a hit on
    // a stripped variant is one inference away, so it scores slightly lower.
    const exactness = variant === variants[0] ? 1 : 0.95;

    for (const name of names) {
      if (name === variant) raise(1 * exactness, false);
      else if (variant.length === 1) {
        if (name.endsWith(variant)) raise(0.7 * exactness, true);
      } else if (name.startsWith(variant)) raise(0.8 * exactness, false);
      else if (name.includes(variant)) raise(0.7 * exactness, false);
    }
  }

  return { score: best, generic };
}

type Mention = { entries: Set<FoodEntry>; start: number; end: number; length: number; form: string };

/**
 * Dataset names that appear inside the phrase as words of their own.
 *
 * A mention has to start where a word starts, and end where that word ends
 * or where only a particle is left of it. So "편의점에서 그릭 요거트" names
 * 그릭요거트, while 컵라면 does not name 라면 (starts mid-word), nor 감자탕
 * 감자 (탕 is not a particle). Overlaps go to the longest: 그릭요거트 over
 * 요거트, 제육덮밥 over 제육.
 */
function embeddedMentions(entries: FoodEntry[], spoken: string): Mention[] {
  const words = spoken.split(/\s+/).filter((word) => word.length > 0);
  const text = words.join("");
  const wordStarts = new Set<number>();
  const wordEnds: number[] = [];
  let offset = 0;
  for (const word of words) {
    wordStarts.add(offset);
    offset += word.length;
    wordEnds.push(offset);
  }

  const found = new Map<string, Mention>();
  for (const entry of entries) {
    for (const form of [entry.name, ...(entry.aliases ?? [])].map(squash)) {
      if (form.length < 2 || HOMOGRAPH_FORMS.has(form)) continue;

      for (let start = text.indexOf(form); start !== -1; start = text.indexOf(form, start + 1)) {
        if (!wordStarts.has(start)) continue;
        const nameEnd = start + form.length;
        const wordEnd = wordEnds.find((end) => end >= nameEnd);
        if (wordEnd === undefined) continue;
        const rest = text.slice(nameEnd, wordEnd);
        if (rest.length > 0 && !WORD_FINAL_PARTICLES.has(rest)) continue;

        const key = `${start}:${form.length}`;
        const mention = found.get(key) ?? { entries: new Set(), start, end: wordEnd, length: form.length, form };
        mention.entries.add(entry);
        found.set(key, mention);
      }
    }
  }

  const chosen: Mention[] = [];
  for (const mention of [...found.values()].sort((a, b) => b.length - a.length)) {
    const overlaps = chosen.some(
      (other) => mention.start < other.start + other.length && other.start < mention.start + mention.length,
    );
    if (!overlaps) chosen.push(mention);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/**
 * The food a longer phrase names, if it names one safely.
 *
 * Only the food at the *end* of the phrase counts, because that is where a
 * Korean report puts what was eaten: "기분이 안좋아서 떡볶이를". A lone food
 * earlier in the phrase — "떡볶이 먹으려다 참고 샐러드" — is not taken,
 * since whatever follows it may be what was actually eaten. Two or more
 * foods are asked about rather than picked from.
 */
function findEmbedded(entries: FoodEntry[], spoken: string): NameSearch {
  // "떡볶이 시켜 먹었어" reaches here as "떡볶이" — the parser takes how the
  // food was got off with the verb (`SERVING_VERBS`). The matcher knows food
  // names, not verbs.
  const mentions = embeddedMentions(entries, spoken);
  const total = squash(spoken).length;
  const last = mentions.at(-1);
  if (last === undefined) return { kind: "none" };

  const said = modifiersBefore(spoken, last);

  if (mentions.length > 1) {
    // "우유 넣은 커피" is one coffee with milk in it, not 우유 and 커피.
    if (said.some(({ kind }) => kind === "addition")) return { kind: "none" };
    const all = [...new Set(mentions.flatMap((mention) => [...mention.entries]))];
    return { kind: "several", entries: all, score: EMBEDDED_SCORE };
  }

  if (last.end !== total) return { kind: "none" };
  return readModifiers(entries, [...last.entries], last.form, said);
}

type SaidModifier = { word: string; kind: ModifierKind };

/**
 * The words in front of the food that describe it: those after the last
 * clause ending. "기분이 안좋아서 떡볶이를" has none; "친구가 사준 구운 계란"
 * has 친구가 · 사준 · 구운. Counted over the words as said, so the squashed
 * offsets of the mention line up with whole words.
 */
function modifiersBefore(spoken: string, mention: Mention): SaidModifier[] {
  const words = spoken.split(/\s+/).filter((word) => word.length > 0);
  const before: string[] = [];
  let offset = 0;
  for (const word of words) {
    if (offset + word.length > mention.start) break;
    before.push(word);
    offset += word.length;
  }
  const classified = before.map((word) => ({ word, kind: classifyModifier(word) }));
  const lastBoundary = classified.map(({ kind }) => kind).lastIndexOf("boundary");
  return classified.slice(lastBoundary + 1);
}

const formsOf = (entry: FoodEntry) => [entry.name, ...(entry.aliases ?? [])].map(squash);

/**
 * What the words in front of a food do to which food it is (2026-10-03).
 *
 * The same reading for a food's own name and for an alias, whatever its
 * `variance` — the only things that count are the words said and the names
 * the dataset has:
 *   - neutral words (temperature, taste, where or from whom it came), manner
 *     words, and narration leave the food as it is: 따뜻한 커피, 편의점 삼각김밥;
 *   - a cooking method must be carried by the entry's own names. If it is
 *     not, the entry named exactly "food + method" is taken (튀긴 고구마 →
 *     고구마튀김, 구운 삼겹살 → 삼겹살구이); if none is, the food is unknown
 *     and asked about under the user's own words (구운 계란, 튀긴 두부) —
 *     never the plain or the boiled one;
 *   - an addition (넣은, 뿌린…) makes it a different food: unknown;
 *   - size keeps the food but not its per-piece weight: the resolver asks
 *     the amount unless grams were said;
 *   - any other word may change the food. It is asked about, except in front
 *     of an approved generic representative (생크림 케이크 → 케이크), which
 *     exists to take kinds the dataset cannot price — but not a cooking
 *     method or an addition it does not carry.
 */
function readModifiers(
  entries: FoodEntry[],
  matched: FoodEntry[],
  form: string,
  said: SaidModifier[],
): NameSearch {
  if (said.some(({ kind }) => kind === "addition")) return { kind: "none" };

  let current = matched;
  for (const { word } of said.filter(({ kind }) => kind === "cooking")) {
    const methodForms = cookingFormsOf(word) ?? [];
    const carries = (entry: FoodEntry) =>
      [entry.name, ...(entry.aliases ?? [])].some((name) => nameCarriesMethod(name, methodForms));
    const agreeing = current.filter(carries);
    if (agreeing.length > 0) {
      current = agreeing;
      continue;
    }
    // No matched entry is cooked this way. The entry named exactly "food +
    // method" is the same food cooked as said; anything looser (김치 →
    // 김치볶음밥) is a different dish.
    const stems = new Set([
      form,
      ...current
        .flatMap(formsOf)
        .filter((name) => !name.includes("_") && !ALL_COOKING_FORMS.some((method) => name.includes(method))),
    ]);
    const named = entries.filter((entry) =>
      formsOf(entry).some((name) =>
        [...stems].some((stem) => methodForms.some((method) => name === stem + method || name === method + stem)),
      ),
    );
    if (named.length === 0) return { kind: "none" };
    current = named;
  }

  const unresolved = said.some(({ kind }) => kind === "unresolved");
  if (unresolved && !current.every((entry) => GENERIC_REPRESENTATIVE_IDS.has(entry.id))) {
    return { kind: "none" };
  }

  const sized = said.some(({ kind }) => kind === "size") ? { sizeQualified: true as const } : {};
  const [first] = current;
  if (current.length === 1 && first !== undefined) {
    return { kind: "one", entry: first, score: EMBEDDED_SCORE, ...sized };
  }
  return { kind: "several", entries: current, score: EMBEDDED_SCORE, ...sized };
}

/**
 * "떡볶" for 떡볶이: the separator 이랑 took the name's last syllable. Both
 * 떡볶+이랑 and 떡볶이+랑 are grammatical, so only the data can tell.
 */
function isParticleSplit(entry: FoodEntry, variants: string[]): boolean {
  const names = [entry.name, ...(entry.aliases ?? [])].map(squash);
  return variants.some((variant) => names.includes(`${variant}이`));
}

export type NameSearch =
  | { kind: "none" }
  | {
      kind: "one";
      entry: FoodEntry;
      score: number;
      /**
       * A size was said ("큰 계란"). The food is known; the weight of one
       * piece is not the published one, so a count cannot be priced.
       */
      sizeQualified?: true;
    }
  | {
      kind: "several";
      entries: FoodEntry[];
      score: number;
      /**
       * True when every candidate was reached only as the *kind* of food the
       * word names — 빵 for 식빵 and 단팥빵, 회 for 연어회 and 육회. Such a
       * match may be asked about but must never be settled on one food, even
       * when the counter the user said fits only one of them.
       */
      generic?: true;
      /** As on `one`: a size was said. */
      sizeQualified?: true;
    };

/**
 * Looks a spoken name up. Returns `several` rather than picking a winner when
 * the top candidates are indistinguishable — "밥" really is ambiguous, and
 * guessing between 흰쌀밥 and 현미밥 is the kind of silent wrong answer this
 * app is built to avoid.
 */
export function findByName(entries: FoodEntry[], spoken: string): NameSearch {
  const variants = nameVariants(spoken);
  if (variants.length === 0) return { kind: "none" };

  const scored: Scored[] = [];
  for (const entry of entries) {
    const { score, generic } = scoreEntry(entry, variants);
    if (score >= MIN_MATCH_SCORE) scored.push({ entry, score, generic });
  }

  if (scored.length === 0) return findEmbedded(entries, spoken);

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best === undefined) return { kind: "none" };

  const tied = scored.filter((row) => best.score - row.score <= TIE_EPSILON);
  if (tied.length === 1) {
    // "빵" ends only 식빵, "회" only 연어회: one food of that kind is not
    // evidence that it is the one meant. Asking needs two to choose from,
    // so a lone generic match is no match at all.
    if (best.generic) return { kind: "none" };
    // The same holds for a longer word that is only *part* of the one name
    // it reaches: "소고기" is not 소고기 우둔살, "순두부" is not 순두부찌개.
    // A general word narrowed to the single specific food the dataset
    // happens to carry is a guess. The one exception is a name cut short by
    // a particle split — "떡볶이랑" read as 떡볶 + 이랑 — where all that is
    // missing is the 이 the separator took.
    if (best.score < 1 * 0.95 && !isParticleSplit(best.entry, variants)) {
      return { kind: "none" };
    }
    return { kind: "one", entry: best.entry, score: best.score };
  }

  return {
    kind: "several",
    entries: tied.map((row) => row.entry),
    score: best.score,
    ...(tied.every((row) => row.generic) ? { generic: true as const } : {}),
  };
}

/**
 * "제육 김치", "라면 하나 김밥": foods said one after another with only a
 * space between them (2026-10-06 feedback). Returns the phrase cut at each
 * food, each piece keeping the amount said after it, or null when the
 * phrase is anything but such a list.
 *
 * Without this, the foods of one phrase were offered as a single choice —
 * "제육볶음, 배추김치 중 어떤 건가요?" — and whichever was not picked was
 * dropped; a counter only one of them publishes ("라면 김밥 두 줄") made the
 * pick silently.
 *
 * Strict on purpose, because a word in front of a food can make it a
 * different food: the whole phrase must not name one food on its own (참치
 * 김밥 is 참치김밥), the last food must not be a generic representative (고구마
 * 케이크), the first word must start a food, and every word between
 * two foods must be an amount — so "우유 넣은 커피" and "편의점 김밥 라면" are
 * left as they were. That two foods were meant is still the user's to say:
 * the caller asks before recording a list it cut.
 */
export function splitListedFoods(entries: FoodEntry[], spoken: string): string[] | null {
  const words = spoken.split(/\s+/).filter((word) => word.length > 0);
  if (words.length < 2) return null;

  const variants = nameVariants(spoken);
  if (entries.some((entry) => scoreEntry(entry, variants).score >= MIN_MATCH_SCORE)) return null;

  const mentions = embeddedMentions(entries, spoken);
  if (mentions.length < 2) return null;

  // "고구마 케이크", "참치 샌드위치": a food in front of a generic
  // representative names a kind of it, not a second food — the question it
  // was always asked, which offers 케이크, still fits.
  const last = mentions.at(-1);
  if (last !== undefined && [...last.entries].every((entry) => GENERIC_REPRESENTATIVE_IDS.has(entry.id))) {
    return null;
  }

  // Where each word starts in the squashed text the mentions are counted in.
  const starts: number[] = [];
  let offset = 0;
  for (const word of words) {
    starts.push(offset);
    offset += word.length;
  }

  const pieces: string[] = [];
  let next = 0;
  for (const mention of mentions) {
    const first = starts.indexOf(mention.start);
    if (first === -1) return null;

    const between = words.slice(next, first);
    if (between.length > 0) {
      const previous = pieces.at(-1);
      if (previous === undefined || parseAmountOnly(between.join(" ")) === null) return null;
      pieces[pieces.length - 1] = `${previous} ${between.join(" ")}`;
    }

    const after = starts.findIndex((start) => start >= mention.end);
    const last = after === -1 ? words.length : after;
    pieces.push(words.slice(first, last).join(" "));
    next = last;
  }

  return next === words.length ? pieces : null;
}

/**
 * Each food a phrase names, with the amount said right after it — for the
 * "둘 다" answer to a choice between them (2026-10-06 user decision).
 *
 * Looser than `splitListedFoods`, because it is never acted on alone: the
 * user is shown the foods and picks "둘 다" themselves. Words that are not
 * an amount ("끓여서", "넣고") are simply not carried, so "라면 끓여서 계란 두
 * 개 넣고" gives 라면 and 계란 두 개. Null when the phrase names fewer than
 * two foods, or names one food on its own.
 */
export function mentionPieces(entries: FoodEntry[], spoken: string): string[] | null {
  const words = spoken.split(/\s+/).filter((word) => word.length > 0);
  const variants = nameVariants(spoken);
  if (entries.some((entry) => scoreEntry(entry, variants).score >= MIN_MATCH_SCORE)) return null;

  const mentions = embeddedMentions(entries, spoken);
  if (mentions.length < 2) return null;

  const starts: number[] = [];
  let offset = 0;
  for (const word of words) {
    starts.push(offset);
    offset += word.length;
  }

  const pieces: string[] = [];
  for (const [index, mention] of mentions.entries()) {
    const first = starts.indexOf(mention.start);
    if (first === -1) return null;
    const after = starts.findIndex((start) => start >= mention.end);
    const last = after === -1 ? words.length : after;
    const nextMention = mentions[index + 1];
    const limit = nextMention === undefined ? words.length : starts.indexOf(nextMention.start);

    // The longest run of following words that reads as an amount, if any.
    let end = last;
    for (let stop = limit; stop > last; stop--) {
      if (parseAmountOnly(words.slice(last, stop).join(" ")) !== null) {
        end = stop;
        break;
      }
    }
    pieces.push(words.slice(first, end).join(" "));
  }
  return pieces;
}
