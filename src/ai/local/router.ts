import { z } from "zod";
import { INTENT_CRITERIA } from "@/ai/judgment/questions";
import { INTENTS, type JudgmentInput } from "@/ai/judgment/types";
import type { LocalLlmClient, LocalLlmResult } from "./client";

/**
 * The local router: one sentence in, one intent out.
 *
 * It classifies and nothing else. It writes no sentence for the user, prices
 * nothing, and points at no existing record — which entry a correction means
 * stays Jev's question. The food names it extracts are recorded for
 * comparison only; the app still reads food and amount with its own parser.
 */

/** The app's intents plus an honest "cannot tell", which always falls back. */
export const LOCAL_INTENTS = [...INTENTS, "unknown"] as const;
export type LocalIntent = (typeof LOCAL_INTENTS)[number];

const foodEntitySchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});

export const localRouteSchema = z.object({
  intent: z.enum(LOCAL_INTENTS),
  confidence: z.number().min(0).max(1),
  /** Did the user say they themselves actually ate or drank something? */
  consumed: z.boolean(),
  entities: z.object({ foods: z.array(foodEntitySchema) }),
});

export type LocalRoute = z.infer<typeof localRouteSchema>;

export interface LocalRouter {
  readonly model: string;
  route(input: JudgmentInput): Promise<LocalLlmResult<LocalRoute>>;
}

/**
 * Instructions in English, the user's Korean verbatim — the same split the
 * Jev questions use. The intent definitions are Jev's own criteria, so the
 * two judges are asked the same question and their disagreements mean
 * something.
 *
 * The examples are deliberately not sentences from either eval set.
 */
const SYSTEM_PROMPT = `You classify one Korean message sent to a calorie-logging app.
You never reply to the user. You output JSON only.

Intents:
${Object.entries(INTENT_CRITERIA)
  .map(([intent, meaning]) => `- ${intent}: ${meaning}`)
  .join("\n")}
- unknown: You cannot tell which of the above the message is.

Fields:
- intent: one of the intents above.
- confidence: 0 to 1, how sure you are of the intent. Below 0.7 when two intents are plausible.
- consumed: true only if the user states they themselves actually ate or drank something, including correcting how much. Questions, plans, cancellations and wishes are false.
- entities.foods: each food or drink named, with quantity (a number, or null) and unit (as written, or null). Never estimate calories.

"Today's log" lists what is already recorded. A message about one of those entries is a correction or a removal, not a new report.

Examples:
"점심에 제육볶음 한 그릇" -> {"intent":"add_food","confidence":0.93,"consumed":true,"entities":{"foods":[{"name":"제육볶음","quantity":1,"unit":"그릇"}]}}
"방금 넣은 우유 지워줘" -> {"intent":"delete_food","confidence":0.95,"consumed":false,"entities":{"foods":[{"name":"우유","quantity":null,"unit":null}]}}
"라면 반만 먹은 거였어" -> {"intent":"modify_food","confidence":0.88,"consumed":true,"entities":{"foods":[{"name":"라면","quantity":0.5,"unit":null}]}}
"지금까지 몇 칼로리 먹었지?" -> {"intent":"ask_status","confidence":0.95,"consumed":false,"entities":{"foods":[]}}
"저녁 메뉴 추천해줘" -> {"intent":"ask_recommendation","confidence":0.94,"consumed":false,"entities":{"foods":[]}}
"떡볶이 칼로리 높아?" -> {"intent":"other","confidence":0.9,"consumed":false,"entities":{"foods":[{"name":"떡볶이","quantity":null,"unit":null}]}}
"내일은 치킨 먹을 거야" -> {"intent":"other","confidence":0.85,"consumed":false,"entities":{"foods":[{"name":"치킨","quantity":null,"unit":null}]}}`;

/** Names and amounts only — ids, calories and times tell the router nothing it needs. */
export function buildUserPrompt(input: JudgmentInput): string {
  const log =
    input.recentItems.length === 0
      ? "(empty)"
      : input.recentItems
          .map((item) => (item.amount === undefined ? item.name : `${item.name} ${item.amount}`))
          .join(", ");
  return `Today's log: ${log}\nMessage: ${input.message}`;
}

export function createLocalRouter(client: LocalLlmClient): LocalRouter {
  return {
    model: client.model,
    route(input) {
      return client.chatJson({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(input),
        schema: localRouteSchema,
      });
    },
  };
}
