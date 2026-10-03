import { foodLikeTokens } from "@/ai/judgment/referenceHeuristic";
import type { RecentItem } from "@/ai/judgment/types";
import { nameVariants } from "@/ai/nutrition/dataset";
import { KOREAN_FOODS } from "@/ai/nutrition/koreanFoods";
import { splitCorrection } from "./correction";

/**
 * Whether the entry a correction is about is the one the user named.
 *
 * The judge picks a target from the twelve newest entries and the code
 * fallback picks the newest substring match. Both go wrong the same way once
 * names overlap: "케이크 700kcal로 고쳐줘" with 케이크, 치즈케이크 and
 * 초콜릿케이크 logged changed the 초콜릿케이크 (2026-10-02, browser). The
 * sentence itself says which one it means, and this reads only that — which
 * logged names it states — and never decides on its own: a disagreement
 * becomes a confirmation or a question, never a different silent pick.
 *
 * A name counts where it is said as itself. "초콜릿케이크" contains 케이크, but
 * that 케이크 is part of a longer name in the same place, so it is not a
 * mention; "케이크랑 초콜릿케이크" says both. "Longer name" includes every
 * dataset name and alias, so a food that is not logged ("치즈케이크로 바꿔줘")
 * also keeps its inner 케이크 from counting.
 */

const squash = (text: string) => text.replace(/\s+/g, "");

/** Spellings a logged name is said in: the name, and its dataset aliases. */
type Lexicon = ReadonlyMap<string, readonly string[]>;

function buildLexicon(): Lexicon {
  const map = new Map<string, string[]>();
  for (const entry of KOREAN_FOODS) {
    const spellings = [entry.name, ...(entry.aliases ?? [])]
      .map(squash)
      // A one-character alias ("김") is a syllable of too many other words.
      .filter((spelling) => spelling.length >= 2);
    map.set(squash(entry.name), spellings);
  }
  return map;
}

const DATASET_LEXICON = buildLexicon();

type Span = { start: number; end: number; record: string | null };

function occurrences(text: string, word: string): number[] {
  const found: number[] = [];
  if (word.length === 0) return found;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    found.push(at);
  }
  return found;
}

/**
 * The logged names a piece of text says, in order, each once.
 *
 * Every logged name and every dataset spelling is located; a span that sits
 * inside a longer span at the same place is dropped. What is left and belongs
 * to a logged entry is a mention of it.
 */
export function mentionedNames(
  text: string,
  items: RecentItem[],
  lexicon: Lexicon = DATASET_LEXICON,
): string[] {
  const said = squash(text);
  const spans: Span[] = [];
  const logged = new Map(items.map((item) => [squash(item.name), item.name]));

  for (const [key, name] of logged) {
    // A one-syllable name (배, 귤, 회) is a syllable of too many other words
    // — 배달, 회사 — to be read as a mention; such an entry is left to the
    // judge and the fallback, as before.
    const spellings = new Set([key, ...(lexicon.get(key) ?? [])].filter((spelling) => spelling.length >= 2));
    for (const spelling of spellings) {
      for (const start of occurrences(said, spelling)) {
        spans.push({ start, end: start + spelling.length, record: name });
      }
    }
  }
  for (const [key, spellings] of lexicon) {
    if (logged.has(key)) continue;
    for (const spelling of spellings) {
      for (const start of occurrences(said, spelling)) {
        spans.push({ start, end: start + spelling.length, record: null });
      }
    }
  }

  const standing = spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other !== span &&
          other.start <= span.start &&
          other.end >= span.end &&
          other.end - other.start > span.end - span.start,
      ),
  );

  const names: string[] = [];
  for (const span of standing.sort((a, b) => a.start - b.start)) {
    if (span.record !== null && !names.includes(span.record)) names.push(span.record);
  }
  return names;
}

/**
 * The part of a correction that names the old entry, when its grammar says
 * so: "A 말고 B", or "A를/A는 …" where A is a logged name. Otherwise the
 * whole sentence, and `certain` is false — "아까 거 치즈케이크였어" names the
 * replacement, not the entry, and nothing in its grammar says which.
 */
function oldSide(message: string, items: RecentItem[]): { text: string; certain: boolean } {
  const replaced = splitCorrection(message, null).previous;
  if (replaced !== null) return { text: replaced, certain: true };

  for (const name of mentionedNames(message, items)) {
    const previous = splitCorrection(message, name).previous;
    if (previous !== null) return { text: previous, certain: true };
  }
  return { text: message, certain: false };
}

/**
 * More than one stored entry. Counted by id, never by what the entries look
 * like: two 케이크 1조각 266 kcal logged in the morning and the afternoon are
 * two records, and changing either one unasked is a guess about which (until
 * 2026-10-03 identical-looking entries were treated as one and the pick — the
 * judge's, or the newest — was applied).
 */
function severalEntries(items: RecentItem[]): boolean {
  return new Set(items.map((item) => item.id)).size > 1;
}

/** The same stored entry listed twice is one entry, not a choice. */
function uniqueById(items: RecentItem[]): RecentItem[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

const byRecency = (items: RecentItem[]) =>
  items.slice().sort((a, b) => b.consumedAt.localeCompare(a.consumedAt));

export type TargetCheck =
  /** The target stands as picked (or there is nothing to check it against). */
  | { kind: "ok" }
  /** The user named one entry and something else was picked: propose that entry. */
  | { kind: "confirm"; targetId: string }
  /** Which entry is meant is not settled by the sentence: ask among these. */
  | { kind: "ask"; candidates: RecentItem[] };

/**
 * Checks a modify target against what the sentence names.
 *
 *   - one name, one entry, and the pick is it: ok;
 *   - one name, several entries of it — even identical-looking ones, which
 *     are still different records: ask among them. Neither the newest nor a
 *     confident pick is a reason to choose one;
 *   - several names: ask among them;
 *   - one name, but a different entry was picked: when the old side is known
 *     from the grammar, or the picked entry is a longer name containing the
 *     one said (the overlap that started this), the named entry is proposed
 *     for confirmation. Otherwise either could be meant, so both are offered;
 *   - no logged name said whole, but a word of the sentence sits inside
 *     several different logged names (김밥 → 참치김밥 · 치즈김밥): ask, rather
 *     than take the most similar.
 */
export function checkModifyTarget(
  message: string,
  items: RecentItem[],
  targetId: string | null,
): TargetCheck {
  items = uniqueById(items);
  const target = items.find((item) => item.id === targetId) ?? null;
  const side = oldSide(message, items);
  const names = mentionedNames(side.text, items);

  if (names.length > 1) {
    const named = byRecency(items.filter((item) => names.includes(item.name)));
    return severalEntries(named) ? { kind: "ask", candidates: named } : { kind: "ok" };
  }

  if (names.length === 1) {
    const name = names[0] as string;
    const sameName = byRecency(items.filter((item) => item.name === name));
    if (severalEntries(sameName)) return { kind: "ask", candidates: sameName };
    if (target !== null && target.name === name) return { kind: "ok" };

    const named = sameName[0];
    if (named === undefined) return { kind: "ok" };
    if (target === null || side.certain || squash(target.name).includes(squash(name))) {
      return { kind: "confirm", targetId: named.id };
    }
    return { kind: "ask", candidates: [...sameName, target] };
  }

  // Nothing logged is named whole. A word may still sit inside logged names;
  // two or more different ones is a guess between them, not a reference.
  const forms = foodLikeTokens(side.text)
    .flatMap(nameVariants)
    .filter((form) => form.length >= 2);
  const similar = byRecency(
    items.filter((item) => forms.some((form) => squash(item.name).includes(form))),
  );
  if (similar.length === 0) return { kind: "ok" };

  const similarNames = new Set(similar.map((item) => item.name));
  if (similarNames.size > 1 || severalEntries(similar)) {
    return { kind: "ask", candidates: similar };
  }
  if (target !== null && similar.some((item) => item.id === target.id)) return { kind: "ok" };
  if (target === null) return { kind: "confirm", targetId: (similar[0] as RecentItem).id };
  return { kind: "ask", candidates: [...similar, target] };
}

/**
 * Entries worth offering when asking which one, best first: the ones the
 * sentence names or nearly names, then the rest newest first. The question
 * shows only a few, so the related ones must not be pushed out by recency.
 */
export function relatedFirst(message: string, items: RecentItem[]): RecentItem[] {
  const names = mentionedNames(message, items);
  const forms = foodLikeTokens(message)
    .flatMap(nameVariants)
    .filter((form) => form.length >= 2);
  const rank = (item: RecentItem) =>
    names.includes(item.name) ? 0 : forms.some((form) => squash(item.name).includes(form)) ? 1 : 2;
  return byRecency(items).sort((a, b) => rank(a) - rank(b));
}
