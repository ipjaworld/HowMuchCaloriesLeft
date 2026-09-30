import { createJudge } from "@/ai/judgment";
import { candidateJudgeFor } from "@/ai/judgment/candidateJudge";
import { withLocalRouter } from "@/ai/local/routing";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { runChat } from "@/application/chatPipeline";
import { env } from "@/env";
import { chatRequestSchema, toJudgmentInput, type ChatResponse } from "./schema";

/**
 * Judgment, plus the nutrition lookup an add needs.
 *
 * This handler reads no storage, holds no session and changes nothing. It
 * turns one sentence plus the state the browser sent into a Command, and the
 * browser decides what to do with it. The API keys live here and nowhere
 * else. What happens between the two is `runChat`.
 */

// The judge is stateless and cheap to keep; rebuilding a client per request
// would throw away connection reuse for nothing. The local router wraps it
// only in development and only when asked — see `docs/local-llm.md`.
const judge = withLocalRouter(createJudge(env.TYPESAFE_API_KEY), env);

// The per-food filter (Phase 8): off unless asked for, and never without a
// real key. See `candidateJudgeFor`.
const candidateJudge = candidateJudgeFor(env);

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

  try {
    const response: ChatResponse = await runChat(
      toJudgmentInput(parsed.data),
      parsed.data.chosen,
      { judge, resolver: koreanFoodResolver, candidateJudge },
    );
    return Response.json(response);
  } catch (error) {
    // A judgment failure is not a reason to guess. The client says so and the
    // user can try again; nothing was changed either way.
    console.error("[chat] judgment failed", error);
    return Response.json({ error: "judgment_unavailable" }, { status: 503 });
  }
}

/** Kept local so the route does not re-export zod helpers. */
function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
