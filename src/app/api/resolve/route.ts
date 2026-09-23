import { z } from "zod";
import { KOREAN_FOODS } from "@/ai/nutrition/koreanFoods";
import { caloriesFor } from "@/ai/nutrition/localDatasetResolver";
import { parseAmountOnly } from "@/ai/nutrition/quantity";
import { toFoodItem } from "@/application/addFood";
import type { NewFoodItem } from "@/application/mealRecords";

/**
 * Pricing a food the user has just told us the size of.
 *
 * When the dataset knows a food but not what one 잔 of it weighs, the app
 * asks, and the answer comes back as "200ml". That is not a new request and
 * must not be judged as one: sent to Jev standalone it would read as `other`,
 * costing a round trip to be told the app cannot help. So the follow-up
 * arrives here instead, where the food is already known and only the amount
 * is in question.
 *
 * Resolution stays on the server for the same reason it always has — the
 * dataset is the server's to hold — and this handler is as stateless as the
 * other one: the client names the entry it is answering about.
 */

const requestSchema = z.object({
  /**
   * The food the question was about, by its dataset name.
   *
   * A name rather than a food code because both callers already hold one: an
   * unanswered add carries the entry it matched, and a correction carries the
   * stored item, whose `name` *is* the dataset's own. Names are unique across
   * the dataset (pinned by the seeds test), so this identifies a row exactly
   * while working for both without a second lookup path.
   */
  foodName: z.string().min(1),
  /** What the user typed: "200ml", "210g", "100 g". */
  amountText: z.string().trim().min(1).max(40),
});

export type ResolveResponse =
  | { status: "resolved"; item: NewFoodItem }
  | { status: "unparseable" }
  | { status: "unmeasurable" };

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const entry = KOREAN_FOODS.find(
    (candidate) => candidate.name === parsed.data.foodName,
  );
  if (entry === undefined) {
    return Response.json({ error: "unknown_entry" }, { status: 404 });
  }

  // The whole message is the amount, which is the one context where a bare
  // "200ml" is a quantity rather than a food name.
  const quantity = parseAmountOnly(parsed.data.amountText);
  if (quantity === null) {
    const response: ResolveResponse = { status: "unparseable" };
    return Response.json(response);
  }

  // "하나" parses too, and for a food with no stated portion it comes straight
  // back unmeasurable — which is the honest answer, not an error.
  const priced = caloriesFor(quantity, entry);

  const response: ResolveResponse =
    priced === null
      ? { status: "unmeasurable" }
      : { status: "resolved", item: toFoodItem(priced) };

  return Response.json(response);
}
