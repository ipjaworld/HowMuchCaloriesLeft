/**
 * Which counter a Korean food is naturally counted in.
 *
 * This is what lets someone type "계란" and get one egg rather than a
 * question. Two different facts are needed to do that, and they come from
 * different places on purpose:
 *
 *   - how many grams one portion is  →  the dataset (식약처 1회 제공량)
 *   - whether that portion is called 개 / 그릇 / 공기 / 잔  →  here
 *
 * The second is a linguistic classification, not a nutrition figure, so
 * deciding it in code breaks no rule. And Korean counters are regular enough
 * by food category that rules settle most of it — reaching for a model first
 * would be the wrong instinct in a project built on the opposite one.
 *
 * Used at ingestion time, not at runtime. Once a dataset entry carries its
 * counter, resolving "계란" is a table lookup.
 */

export const COUNTERS = [
  "개",
  "그릇",
  "공기",
  "잔",
  "조각",
  "장",
  "줄",
  "봉지",
  "팩",
  "병",
  "마리",
  "인분",
] as const;

export type Counter = (typeof COUNTERS)[number];

type Rule = { counter: Counter; match: RegExp };

/**
 * Ordered: the first match wins, so anything that a later generic suffix
 * would swallow has to come first. 삼각김밥 ends in 밥 but is not counted in
 * 공기, and 컵라면 ends in 면 but is not counted in 그릇.
 */
const RULES: Rule[] = [
  // Items a generic suffix below would otherwise claim.
  {
    counter: "개",
    match: /삼각김밥|주먹밥|김밥말이|컵라면|봉지라면|호빵|찐빵/,
  },
  { counter: "줄", match: /김밥/ },

  // Soups and stews, served in a bowl. 육개장 and 청국장 end in 장, not 국,
  // so they need naming rather than a suffix.
  {
    counter: "그릇",
    match: /탕$|탕밥|국밥|해장국|찌개|전골|스프|수프|죽$|국$|개장$|청국장|장국$/,
  },

  // Noodles, also a bowl.
  { counter: "그릇", match: /라면|국수|우동|소바|파스타|스파게티|쌀국수|냉면|짜장면|짬뽕|칼국수|면$/ },

  // Rice, served in a 공기.
  { counter: "공기", match: /공기밥|쌀밥|현미밥|잡곡밥|보리밥|비빔밥|볶음밥|밥$/ },

  // Drinks. Bottles and cartons are distinguished because the portion differs.
  { counter: "병", match: /맥주|소주|막걸리|와인|콜라|사이다|탄산수|생수/ },
  { counter: "팩", match: /우유|두유|요구르트|요거트드링크/ },
  {
    counter: "잔",
    match: /커피|아메리카노|라떼|카푸치노|마키아토|에스프레소|아아|차$|녹차|홍차|주스|에이드|스무디|쉐이크|음료/,
  },

  // Eggs and produce, counted individually.
  { counter: "개", match: /계란|달걀|메추리알|알$/ },
  {
    counter: "개",
    match: /사과|배$|바나나|귤$|오렌지|자두|복숭아|키위|망고|토마토|아보카도|감자|고구마|양파|당근|오이$|가지$|옥수수|파프리카|레몬/,
  },

  // Sliced or portioned things.
  { counter: "조각", match: /피자|케이크|파이$|수박|멜론|참외|식빵/ },
  { counter: "조각", match: /치킨|닭다리|닭날개|윙$/ },

  // Sheets.
  { counter: "장", match: /김$|김구이|조미김|토르티야|라이스페이퍼|슬라이스치즈/ },

  // Packaged snacks.
  { counter: "봉지", match: /과자|스낵|젤리|사탕|칩스|프레첼/ },

  // Whole animals.
  { counter: "마리", match: /생선|고등어|갈치|오징어|새우$|게$|꽃게|전복/ },

  // Bakery and handheld items.
  { counter: "개", match: /빵$|크로와상|베이글|도넛|머핀|쿠키|만두|핫도그|햄버거|샌드위치|버거$|토스트|떡$|어묵/ },

  // Single-serve sweets and cups.
  { counter: "개", match: /초콜릿|초코바|아이스크림|요거트|요구르트|푸딩|푸라페/ },
];

/**
 * The counter this food takes, or null when nothing recognises it.
 *
 * Null is a real answer and the caller must handle it: a food with no natural
 * counter is measured by weight, and guessing "1개 of 삼겹살" would be worse
 * than saying nothing.
 */
export function inferCounter(foodName: string): Counter | null {
  const name = foodName.replace(/\s+/g, "");
  if (name.length === 0) return null;

  for (const rule of RULES) {
    if (rule.match.test(name)) return rule.counter;
  }
  return null;
}

/**
 * How ingestion should describe one portion of this food.
 *
 * `개` when the food is countable, `인분` as the honest fallback for anything
 * measured by weight — the portion is still real, it just has no count.
 */
export function naturalServingUnit(foodName: string): Counter {
  return inferCounter(foodName) ?? "인분";
}
