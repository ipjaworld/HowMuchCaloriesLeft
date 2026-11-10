/**
 * Words around a meal that are not a food and should not be asked about.
 *
 * "김밥 먹었는데 너무 맛있었어" leaves "너무 맛있었어" as a slice, and a slice
 * the dataset does not know is asked about: "너무 맛있었어의 칼로리를
 * 알려주세요". That question costs the user a reply and tells them the app
 * did not understand a plain sentence.
 *
 * This is only ever asked of a slice the dataset could *not* place. A known
 * food is never tested here, so nothing below can take a food off a record —
 * "김치전에 막걸리" resolves 김치전 long before the 전 rule could see it. What
 * it can do wrong is drop a food the dataset lacks whose name is also one of
 * these phrases, which is why each rule is a closed shape that must cover the
 * whole slice, not a keyword found somewhere inside it.
 */

/** Laughter, crying and stray punctuation: ㅎㅎ, ㅋㅋㅋ, ㅠㅠ, ~. */
const FILLER = /^[ㅋㅎㅠㅜ~!?.^;]+$/;

const ADVERBS = new Set([
  "너무", "진짜", "정말", "완전", "되게", "엄청", "아주", "좀", "꽤", "그냥", "역시", "근데", "그래서",
  "오늘", "지금", "이제", "벌써", "또", "다", "나", "난", "나는",
]);

/**
 * How it tasted and how the eater feels, as a whole word in any ending. The
 * short stems are spelled out with their endings: 짜 and 달 begin 짜장면 and
 * 달걀, so "starts with 짜" would throw a food away.
 */
const COMMENT = new RegExp(
  `^(?:${[
    "맛(?:있|없|나|났)[가-힣]*",
    "매(?:워|웠)[가-힣]*",
    "맵(?:다|네|네요|더라|긴)",
    "짜(?:다|네|네요|요|더라)|짰[가-힣]*",
    "달(?:다|네|네요|아|아요|았어|았다|더라)",
    "(?:싱거|느끼|든든|더부룩|피곤|행복|후회|만족|괜찮)[가-힣]*",
    "배(?:불|부르|고파|고프|고팠)[가-힣]*",
    "졸(?:려|리)[가-힣]*",
    "(?:죽|살)겠[가-힣]*",
    "좋(?:았|아|다|네)[가-힣]*",
    "별로(?:였|야|다|네)?[가-힣]{0,2}",
    "나니까",
    "고민",
  ].join("|")})[.!?~ㅋㅎㅠㅜ^]*$`,
);

function isComment(word: string): boolean {
  return COMMENT.test(word);
}

/** "고민 중이야", "다이어트 중": a state, when the word before it is not a food. */
const STATE_TAIL = /^중(?:이야|이에요|임|이다|인데)?$/;

/** What someone did around the meal, with 하다: 운동했어, 산책하고, 야근함. */
const ACTIVITY =
  /^(?:퇴근|출근|운동|헬스|회의|야근|산책|공부|수업|청소|샤워|등산|러닝|요가|필라테스|업무|알바|미팅|회식|데이트|쇼핑|게임|수영|출장|과제|빨래|설거지|외출|다이어트|단식|금식)(?:했|하고|해서|함|한|하다|하는|했는데|하러)[가-힣]*$/;

/** A meal that was not had: 굶었어, 걸렀어, 건너뛰었어, 참았어. */
const SKIPPED = /^(?:굶|거르|걸러|걸렀|건너뛰|건너뛰었|참았|참음|참고)[가-힣]*$/;

const MEAL_TIME = /^(?:아침|점심|저녁|야식|간식|낮|밤|새벽|오전|오후)(?:은|는|을|를|도|에|엔)?$/;

/** Family and company, as the subject of some other verb: "동생이", "엄마가". */
const PERSON_SUBJECT =
  /^(?:친구|친구들|동생|엄마|아빠|언니|오빠|누나|형|가족|남친|여친|남자친구|여자친구|애인|남편|아내|와이프|딸|아들|아이|애들|동료|동료들|팀원|팀원들|선배|후배|룸메|룸메이트)(?:이|가|은|는|도)$/;

/**
 * True when every word of the slice is talk around the meal.
 *
 * `text` is a slice the dataset did not know, as the user said it.
 */
export function isNonFoodPhrase(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return false;

  // "헬스장 가기 전", "밥 하기 귀찮아서 … 때문": the frame a meal is set in —
  // before or after doing something, or because of something.
  const last = words.at(-1) ?? "";
  if (words.length >= 2) {
    if (/^(?:전|후|뒤)$/.test(last) && /기$/.test(words.at(-2) ?? "")) return true;
    if (/^(?:때문|덕분|탓)$/.test(last)) return true;
  }

  // "굶고 점심", "점심을 걸러서 저녁": a meal skipped, then the time of the
  // one that was eaten. Only meal times and the skipping itself.
  if (words.some((word) => SKIPPED.test(word)) && words.every((word) => SKIPPED.test(word) || MEAL_TIME.test(word) || ADVERBS.has(word)))
    return true;

  if (words.length === 1 && PERSON_SUBJECT.test(last)) return true;

  // Everything else has to be made of nothing but commentary, and has to
  // contain some: a lone adverb ("그냥") says too little to throw away.
  let said = false;
  for (const [index, word] of words.entries()) {
    if (FILLER.test(word) || ADVERBS.has(word)) continue;
    if (isComment(word) || ACTIVITY.test(word)) {
      said = true;
      continue;
    }
    if (STATE_TAIL.test(word) && index > 0 && said) continue;
    return false;
  }
  return said;
}
