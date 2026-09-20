import { createJudge } from "@/ai/judgment";
import { decideCommand } from "@/application/commands";
import { env } from "@/env";
import { chatRequestSchema, toJudgmentInput, type ChatResponse } from "./schema";

/**
 * Judgment only.
 *
 * This handler reads no storage, holds no session and changes nothing. It
 * turns one sentence plus the state the browser sent into a Command, and the
 * browser decides what to do with it. The API keys live here and nowhere
 * else.
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
    const command = decideCommand(judgment, input);
    const response: ChatResponse = { command, judgment };
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
