import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { accountAuth, accountConfigured, sameOrigin } from "@/infrastructure/accountAuth";

const restoreSchema = z.object({
  consent: z.literal(true),
  profileConsent: z.boolean(),
  disconnectedAt: z.iso.datetime({ offset: true }),
}).strict();

export async function POST(request: NextRequest) {
  if (!accountConfigured() || env.ACCOUNT_RECOVERY_ENABLED !== "on")
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, finish } = accountAuth(request);
  const fail = (error: string, status: number) => finish(NextResponse.json({ error }, { status }));
  const { data: { user }, error } = await client.auth.getUser();
  if (!user || error) return fail("unauthorized", 401);
  if (request.headers.get("x-account-id") !== user.id) return fail("account_changed", 409);
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 1000) return fail("too_large", 413);
    input = JSON.parse(body);
  } catch { return fail("invalid_json", 400); }
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) return fail("consent_required", 400);
  const { error: restored } = await client.rpc("restore_my_account", {
    expected_disconnected_at: parsed.data.disconnectedAt,
    restore_profile: parsed.data.profileConsent,
  });
  if (restored) return fail(restored.code === "22023" ? "recovery_expired_or_changed"
    : restored.code === "42501" ? "reauthentication_required" : "restore_failed",
  restored.code === "22023" ? 409 : restored.code === "42501" ? 403 : 503);
  return finish(NextResponse.json({ ok: true }));
}
