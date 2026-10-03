/**
 * What the words in front of a food name do to *which food* it is.
 *
 * "따뜻한 커피" is coffee; "구운 계란" is not the boiled egg the bare word
 * 계란 stands for; "큰 계란" is an egg whose per-egg weight is not the
 * published one; "설탕 넣은 커피" is not plain coffee. Word count, spacing,
 * whether a name or an alias matched, and `variance` say none of this — so
 * the matcher reads these small tables instead (2026-10-03).
 *
 * The tables are deliberately short. They name *kinds* of modifier that
 * apply to any food, never a food-and-word pair. A word in none of them is
 * unresolved: it may change what the food is, so the food is asked about
 * rather than recorded — except in front of an approved generic
 * representative, which exists to take kinds the dataset cannot price.
 *
 * Nothing here is a number. A cooking word can move the match to the entry
 * that already names that method (구운 삼겹살 → 삼겹살구이); it never makes
 * one up.
 */

/** Describe the food without changing it: temperature, taste. Kept in a label. */
const DESCRIPTION_WORDS = new Set([
  "따뜻한", "뜨거운", "뜨끈한", "따끈한", "차가운", "시원한", "미지근한", "식은", "아이스", "핫",
  "맛있는", "맛없는", "맛난", "좋아하는",
]);

/** Where or from whom it came — narration about the food, not part of it. Left out of a label. */
const PROVENANCE_WORDS = new Set([
  // bought, ordered, received, left over by someone
  "산", "시킨", "주문한", "배달시킨", "받은", "얻은", "남긴", "남은",
  // places, as bare nouns ("편의점 삼각김밥")
  "편의점", "카페", "회사", "학교", "집", "식당", "마트", "빵집", "매점", "휴게소", "구내식당", "학식", "시장", "동네", "뷔페",
]);

/**
 * Provision and direction suffixes: 사준 · 해준 · 만들어준 · 챙겨준,
 * 사온 · 싸온 · 포장해온. A verb ending in these says who brought the food,
 * not what it is.
 */
const NEUTRAL_SUFFIXES = ["준", "다준", "온", "해온"];

/** Manner words that only say how a cooking verb went: 잘, 아주, 바삭하게. */
const MANNER_WORDS = new Set(["잘", "아주", "푹", "살짝", "바싹", "바짝", "노릇노릇", "너무", "완전"]);

/** Size. The food is known; its per-piece weight is not the published one. */
const SIZE_WORDS = new Set(["큰", "작은", "커다란", "조그만", "왕", "대왕", "점보", "미니", "대", "중", "소"]);

/**
 * Cooking methods, each with the forms the dataset writes it in. A stated
 * method agrees with an entry only when one of the entry's own names carries
 * one of these forms.
 */
const COOKING_FORMS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [["구운", "군"], ["구이", "구운", "군"]],
  [["삶은"], ["삶은"]],
  [["튀긴"], ["튀김", "튀긴"]],
  [["볶은"], ["볶음", "볶은"]],
  [["찐"], ["찐"]],
  [["훈제", "훈제한", "훈제된"], ["훈제"]],
  [["조린", "졸인"], ["조림"]],
  [["데친"], ["데친"]],
  [["부친"], ["부침", "전"]],
  [["무친"], ["무침"]],
];

/** Something was put in or on it — the food is no longer the plain one. */
const ADDITION_WORDS = new Set(["넣은", "넣은거", "들어간", "올린", "얹은", "뿌린", "섞은", "추가한", "곁들인", "바른", "찍은", "탄", "타먹은"]);

/** Case particles: a word ending in one is an argument of a verb, not a modifier of the food. */
const ARGUMENT_PARTICLES = ["에서", "에게", "한테", "이랑", "하고", "으로", "까지", "부터", "처럼", "보다", "이", "가", "을", "를", "에", "랑", "와", "과", "도", "의", "로"];

/**
 * Clause endings: everything up to such a word is narration ("기분이
 * 안좋아져서 | 떡볶이를"). 서 alone, because the vowel before it contracts —
 * 와서, 고파서, 좋아져서.
 */
const CLAUSE_ENDINGS = /(?:서|고|며|는데|은데|니까|지만|다가|먹다)$/;

/**
 * Time words and short pronouns are narration too, wherever they sit — "전
 * 오늘 김밥", "점심때 짜장면", "저녁은 라면" (at the front the parser already
 * removes them).
 */
const TIME_WORDS = new Set(["오늘", "어제", "아까", "방금", "지금", "이따", "아침", "점심", "저녁", "간식", "야식", "새벽", "밤늦게", "주말"]);
const TIME_PARTICLES = /(?:때는|때|에는|엔|에|은|는|으로|로)$/;
const PRONOUNS = new Set(["나", "난", "전", "저", "내가", "제가", "우리", "우린"]);

function isNarration(word: string): boolean {
  if (PRONOUNS.has(word) || TIME_WORDS.has(word)) return true;
  const bare = word.replace(TIME_PARTICLES, "");
  return bare !== word && TIME_WORDS.has(bare);
}

export type ModifierKind =
  | "description"
  | "provenance"
  | "manner"
  | "size"
  | "cooking"
  | "addition"
  | "argument"
  | "boundary"
  | "unresolved";

export function classifyModifier(word: string): ModifierKind {
  if (DESCRIPTION_WORDS.has(word)) return "description";
  if (PROVENANCE_WORDS.has(word)) return "provenance";
  if (MANNER_WORDS.has(word) || (word.length >= 3 && word.endsWith("게"))) return "manner";
  if (SIZE_WORDS.has(word)) return "size";
  if (cookingFormsOf(word) !== null) return "cooking";
  if (ADDITION_WORDS.has(word)) return "addition";
  if (NEUTRAL_SUFFIXES.some((suffix) => word.length > suffix.length && word.endsWith(suffix))) return "provenance";
  if (isNarration(word) || CLAUSE_ENDINGS.test(word)) return "boundary";
  if (ARGUMENT_PARTICLES.some((particle) => word.length > particle.length && word.endsWith(particle))) return "argument";
  return "unresolved";
}

/**
 * The words of a longer phrase that name the food as described — for the
 * name a food the dataset lacks is asked about and stored under.
 *
 * "친구가 사준 구운 계란" is asked about as 구운 계란; "따뜻한 설탕 넣은 커피"
 * stays whole, because every word in front of 커피 says something about it.
 * Narration (up to a clause ending, then who and where) is left out. Null
 * when a word in front of the food is not one of the kinds above — then the
 * phrase is talk, not a name, and the caller keeps its stricter reading.
 */
export function describedFoodWords(words: readonly string[]): string[] | null {
  const kinds = words.map(classifyModifier);
  let from = kinds.lastIndexOf("boundary") + 1;
  while (from < words.length - 1 && (kinds[from] === "argument" || kinds[from] === "provenance")) from += 1;

  const kept = words.slice(from);
  // A described food has at least one word describing it. A lone word left
  // after the narration is cut ("…같고 뭔가") is talk, not a name.
  if (kept.length < 2) return null;
  for (let index = from; index < words.length - 1; index += 1) {
    const kind = kinds[index];
    const next = kinds[index + 1];
    const describes = kind === "description" || kind === "manner" || kind === "size" || kind === "cooking" || kind === "addition";
    // "설탕 넣은", "설탕을 넣은": what was put in, right before the word that says so.
    const ingredient = (kind === "unresolved" || kind === "argument") && next === "addition";
    if (!describes && !ingredient) return null;
  }
  return kept;
}

/** The dataset forms of a cooking word, or null when it is not one. */
export function cookingFormsOf(word: string): readonly string[] | null {
  for (const [said, forms] of COOKING_FORMS) if (said.includes(word)) return forms;
  return null;
}

/** Every dataset form of every cooking method, for taking a method out of a name. */
export const ALL_COOKING_FORMS: readonly string[] = [...new Set(COOKING_FORMS.flatMap(([, forms]) => forms))]
  .sort((a, b) => b.length - a.length);

/**
 * Entries approved to stand for kinds the dataset cannot price separately —
 * "생크림 케이크" → 케이크, "교촌 치킨" → 치킨. Taken from the reviewed lists
 * (handoff "일반 이름 대표값" table, the 2026-10-02 product decision on brands,
 * the seeds note on 피자 · 초밥 · 스테이크), by MFDS food code. Not every
 * `variance: "high"` entry is one: 마라탕 or 계란말이 vary but name one dish.
 * Such an entry takes an unknown word in front of it; it does not take a
 * cooking method or an addition it does not carry.
 */
export const GENERIC_REPRESENTATIVE_IDS: ReadonlySet<string> = new Set([
  "P101-409000400-7001", // 케이크
  "P102-005010100-F001-009", // 아이스크림
  "D102-096150000-0001", // 샌드위치
  "P123-302030100-3289", // 만두
  "P109-003030200-F001-001", // 주스
  "D403-161000000-0001", // 스파게티 (파스타)
  "D301-004000000-0001", // 국밥
  "D427-763000000-0001", // 회
  "P101-013000100-F001-004", // 쿠키
  "P123-026020200-F001-000", // 주먹밥
  "P108-003000300-F001-001", // 컵라면
  "P108-009000400-0208", // 비빔면
  "P116-400040000-0065", // 시리얼
  "P103-101010400-0003", // 초콜릿
  "P119-900090200-0873", // 치즈
  "D306-280080000-0001", // 매운탕
  "D105-216180000-0001", // 된장국
  "D320-731060000-0001", // 밀크티
  "D311-532081900-0001", // 장조림
  "D102-120350000-0001", // 피자
  "D101-042200000-0001", // 초밥
  "D108-387140000-0001", // 스테이크
  "D303-147340000-0001", // 라멘
  "D312-549000000-0001", // 치킨
]);
