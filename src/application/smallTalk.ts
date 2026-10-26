import type { NutritionResolver } from "@/ai/nutrition/types";
import { resolveAddParts } from "./addFood";

/**
 * What a sentence that changes nothing was about, so the reply can answer
 * it instead of repeating "먹은 걸 말씀해주시면 기록할게요." (D07,
 * 2026-10-26: a conversation-shaped screen has to take a conversational turn).
 *
 * Read only after the judge has already decided the sentence is not a
 * record — `other`, an uneaten mention, or a recommendation question. So by
 * construction this can change what the app *says*, never what it stores.
 *
 * The figures in a food answer come from the same dataset lookup an add
 * uses (D01); nothing here makes a number up.
 */

/** One food the user asked about, priced the way an add would price it. */
export type FoodFact = {
  name: string;
  amount?: string;
  calories: number;
  /** The figure rests on an assumed serving or an estimate, so the reply says 약. */
  estimated: boolean;
};

export type Talk =
  | { kind: "food_info"; foods: FoodFact[] }
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "hungry" }
  | { kind: "full" };

/** Most foods one answer lists; a longer list stops being an answer. */
const MAX_FOODS = 3;

/**
 * Where a question about a food starts. Only a sentence with one of these is
 * read for foods: without it, "빵 터졌네" or "사과했는데" would be answered
 * with the calories of bread and apples.
 */
const FOOD_QUESTION =
  /칼로리|kcal|열량|살\s*(?:찌|쪄|찔)|먹을까|먹어도|먹을\s*(?:거|건데|건|예정|래)|먹으려(?:고|구)|먹고\s*싶|먹고\s*올게/i;

/** Whole words between the food and the cue that are not part of the food. */
const TRAILING_FILLER = /(?:\s+(?:몇|얼마나|얼마|대충|대략|정도|혹시|좀|진짜|너무))+\s*$/u;
/**
 * A particle left on the food ("떡볶이는 칼로리"). Tried only when the phrase
 * as said finds nothing, and never 이/가: 떡볶이 and 순대국이 end in one.
 */
const TRAILING_PARTICLE = /(?:은|는|을|를|도|의|이랑|랑|하고)$/u;

const GREETING = /^\s*(?:안녕|하이|헬로|반가워|반갑|ㅎㅇ|hi\b|hello\b)/i;
const THANKS = /고마워|고맙|감사|땡큐|ㄳ|ㄱㅅ|thank/i;
const HUNGRY = /배\s*(?:고파|고프|고픈|고팡)|출출/;
const FULL = /배\s*(?:불러|부르|부름|터지|터질)|배부/;

export async function readTalk(message: string, resolver: NutritionResolver): Promise<Talk | null> {
  const cue = FOOD_QUESTION.exec(message);
  if (cue !== null) {
    const phrase = message.slice(0, cue.index).replace(TRAILING_FILLER, "").trim();
    for (const candidate of new Set([phrase, phrase.replace(TRAILING_PARTICLE, "").trim()])) {
      if (candidate === "") continue;
      const foods = await foodFacts(candidate, resolver);
      if (foods.length > 0) return { kind: "food_info", foods };
    }
  }
  if (THANKS.test(message)) return { kind: "thanks" };
  if (GREETING.test(message)) return { kind: "greeting" };
  if (HUNGRY.test(message)) return { kind: "hungry" };
  if (FULL.test(message)) return { kind: "full" };
  return null;
}

async function foodFacts(phrase: string, resolver: NutritionResolver): Promise<FoodFact[]> {
  const parts = await resolveAddParts(phrase, resolver);
  return parts
    .flatMap((part) =>
      part.status === "resolved"
        ? [
            {
              name: part.item.name,
              ...(part.item.amount === undefined ? {} : { amount: part.item.amount }),
              calories: part.item.calories,
              estimated: part.item.caloriesEstimated || part.amountAssumed === true,
            },
          ]
        : [],
    )
    .slice(0, MAX_FOODS);
}
