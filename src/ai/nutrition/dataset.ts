import { z } from "zod";
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

type Mention = { entries: Set<FoodEntry>; start: number; end: number; length: number };

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
        const mention = found.get(key) ?? { entries: new Set(), start, end: wordEnd, length: form.length };
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

  const [only] = mentions;
  if (mentions.length === 1 && only !== undefined) {
    if (only.end !== total) return { kind: "none" };
    const matched = [...only.entries];
    const [first] = matched;
    if (matched.length === 1 && first !== undefined) {
      return { kind: "one", entry: first, score: EMBEDDED_SCORE };
    }
    return { kind: "several", entries: matched, score: EMBEDDED_SCORE };
  }

  if (mentions.length > 1) {
    const all = [...new Set(mentions.flatMap((mention) => [...mention.entries]))];
    return { kind: "several", entries: all, score: EMBEDDED_SCORE };
  }

  return { kind: "none" };
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
  | { kind: "one"; entry: FoodEntry; score: number }
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
