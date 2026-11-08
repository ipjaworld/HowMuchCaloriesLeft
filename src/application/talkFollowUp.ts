/**
 * "먹었어" right after the app answered a question about a food
 * (2026-11-08 QA-02).
 *
 * The answer to "오늘 저녁 떡볶이 먹을까?" says how to report it once eaten.
 * A bare "먹었어" in reply names no food, so on its own it was asked to be
 * confirmed and then dropped: "무엇을 드셨는지 알려주세요." Here it is read as
 * about the food just answered for — the sentence the user would otherwise
 * have had to retype — and that sentence goes to the judge as usual. Whether
 * it was eaten is still Jev's to judge; this only restores the food it is
 * about.
 */

/**
 * A bare report of having eaten, with nothing in it naming a food: an
 * optional yes-word ("응", "네,"), an optional adverb that keeps it about the
 * same food ("결국", "방금", "다"), and a finished eating verb in whatever
 * ending ("먹었어", "먹었어요", "먹음", "마셨어").
 */
const BARE_ATE =
  /^(?:(?:응|어|웅|ㅇㅇ|네|넹|넵|예|그래)[\s,.!~]*)?(?:(?:결국|방금|아까|이미|벌써|그냥|다)\s*)*(?:먹었|먹엇|먹음|마셨|마심|드셨)[가-힣]*[\s.!~ㅋㅎ^]*$/u;

/**
 * The sentence to send for `message`, given the food the previous reply was
 * about (null when it was about none). Anything but a bare "먹었어" is sent
 * as typed.
 */
export function followUpMessage(message: string, previousFood: string | null): string {
  if (previousFood === null || previousFood.trim() === "") return message;
  const trimmed = message.trim();
  if (!BARE_ATE.test(trimmed)) return message;
  const verb = /(?:먹었|먹엇|먹음|마셨|마심|드셨)[가-힣]*/u.exec(trimmed)?.[0] ?? "먹었어";
  return `${previousFood.trim()} ${verb}`;
}
