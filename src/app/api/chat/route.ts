import { createJudge } from "@/ai/judgment";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { resolveAddParts } from "@/application/addFood";
import { decideCommand, type Command } from "@/application/commands";
import { env } from "@/env";
import { chatRequestSchema, toJudgmentInput, type ChatResponse } from "./schema";

/**
 * Judgment, plus the nutrition lookup an add needs.
 *
 * This handler reads no storage, holds no session and changes nothing. It
 * turns one sentence plus the state the browser sent into a Command, and the
 * browser decides what to do with it. The API keys live here and nowhere
 * else.
 *
 * An `add_candidate` or a `modify_candidate` is expanded here rather than in
 * `decideCommand`: looking food up is async and needs a dataset, while the
 * confidence policy is a pure function worth keeping that way. What goes back
 * is typed per phrase — the client never parses a sentence to work out what
 * happened.
 */

// The judge is stateless and cheap to keep; rebuilding a client per request
// would throw away connection reuse for nothing.
const judge = createJudge(env.TYPESAFE_API_KEY);

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_request", detail: formatIssues(parsed.error) },
      { status: 400 },
    );
  }

  const input = toJudgmentInput(parsed.data);

  try {
    const judgment = await judge.judge(input);
    const decided = decideCommand(judgment, input);

    const command = await expand(decided);

    const response: ChatResponse = { command, judgment };
    return Response.json(response);
  } catch (error) {
    // A judgment failure is not a reason to guess. The client says so and the
    // user can try again; nothing was changed either way.
    console.error("[chat] judgment failed", error);
    return Response.json({ error: "judgment_unavailable" }, { status: 503 });
  }
}

/**
 * Fills a decided command in with what the dataset knows.
 *
 * Both an add and a correction need the same lookup, so both get it here
 * rather than in `decideCommand`, which stays a pure function over the
 * judgment.
 */
async function expand(decided: Command): Promise<Command> {
  if (decided.type === "add_candidate") {
    return {
      type: "add",
      sourceText: decided.sourceText,
      needsConfirmation: decided.needsConfirmation,
      parts: await resolveAddParts(decided.sourceText, koreanFoodResolver),
    };
  }

  if (decided.type === "modify_candidate") {
    return {
      ...decided,
      parts: await resolveAddParts(decided.sourceText, koreanFoodResolver),
    };
  }

  return decided;
}

/** Kept local so the route does not re-export zod helpers. */
function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
