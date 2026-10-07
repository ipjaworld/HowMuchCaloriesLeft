import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { usageLimitResponse } from "@/application/usageLimits";
import { accountAuth, accountConfigured } from "./accountAuth";
import { usageLimits } from "./serverUsageLimits";

/** Additional account bucket; the caller always checks its IP bucket first. */
export async function checkAccountUsage(
  request: Request,
  route: "chat" | "resolve",
) {
  const unchanged = (response: Response) => response;
  if (!accountConfigured()) return { rejection: null, finish: unchanged };
  const { client, finish: finishSession } = accountAuth(
    new NextRequest(request.url, { headers: request.headers }),
  );
  const finish = (response: Response) =>
    finishSession(new NextResponse(response.body, response));
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (
    error &&
    error.name !== "AuthSessionMissingError" &&
    error.status !== 401 &&
    error.status !== 403
  ) {
    return {
      rejection: finish(
        Response.json({ error: "judgment_unavailable" }, { status: 503 }),
      ),
      finish,
    };
  }
  if (!user) return { rejection: null, finish };
  const identity = createHmac("sha256", env.RATE_LIMIT_SECRET!)
    .update(`account:${user.id}`)
    .digest("hex");
  const admission = await usageLimits.checkRequest(
    route,
    `account:${identity}`,
  );
  return {
    rejection: admission.allowed
      ? null
      : finish(usageLimitResponse("rate_limited", admission.retryAfter)),
    finish,
  };
}
