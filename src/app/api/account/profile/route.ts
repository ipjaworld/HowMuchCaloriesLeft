import { NextRequest, NextResponse } from "next/server";
import {
  accountAuth,
  accountConfigured,
  sameOrigin,
} from "@/infrastructure/accountAuth";
import { dietProfileSchema } from "@/infrastructure/profileSchema";
import { ACCOUNT_POLICY_VERSION } from "@/domain/account";
import { z } from "zod";
const enable = z
  .object({ consent: z.literal(true), profile: dietProfileSchema.nullable() })
  .strict();
const edit = z
  .object({
    profile: dietProfileSchema,
    revision: z.number().int().nonnegative(),
    consentAt: z.string().min(1).max(64),
  })
  .strict();
async function handle(request: NextRequest) {
  if (!accountConfigured())
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (request.method !== "GET" && !sameOrigin(request))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, finish } = accountAuth(request),
    fail = (error: string, status: number) =>
      finish(NextResponse.json({ error }, { status }));
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return fail("unauthorized", 401);
  if (request.headers.get("x-account-id") !== user.id)
    return fail("account_changed", 409);
  const { data: row, error: readError } = await client
    .from("account_profiles")
    .select("profile,revision,consent_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) return fail("read_failed", 503);
  if (request.method === "GET")
    return finish(
      NextResponse.json({
        enabled: !!row,
        profile: row?.profile ?? null,
        revision: row?.revision ?? 0,
        consentAt: row?.consent_at ?? null,
      }),
    );
  if (request.method === "DELETE") {
    if (request.headers.get("x-revision") !== String(row?.revision ?? 0)
      || (row && request.headers.get("x-consent-at") !== row.consent_at))
      return fail("conflict", 409);
    const disabled = { enabled: false, profile: null, revision: 0, consentAt: null };
    if (!row) return finish(NextResponse.json(disabled));
    const { data: deleted, error: removed } = await client
      .from("account_profiles")
      .delete()
      .eq("user_id", user.id)
      .eq("revision", row.revision)
      .eq("consent_at", row.consent_at)
      .select("user_id")
      .maybeSingle();
    if (removed) return fail("delete_failed", 503);
    return deleted
      ? finish(NextResponse.json(disabled))
      : fail("conflict", 409);
  }
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 2000) return fail("too_large", 413);
    raw = JSON.parse(text);
  } catch {
    return fail("invalid_json", 400);
  }
  if (request.method === "POST") {
    const parsed = enable.safeParse(raw);
    if (!parsed.success) return fail("consent_required", 400);
    if (row) return fail("conflict", 409);
    const { data: created, error: saved } = await client
      .from("account_profiles")
      .insert({
        user_id: user.id,
        profile: parsed.data.profile,
        consent_version: ACCOUNT_POLICY_VERSION,
      })
      .select("profile,revision,consent_at")
      .single();
    return saved || !created
      ? fail("save_failed", 503)
      : finish(NextResponse.json({ enabled: true, profile: created.profile,
        revision: created.revision, consentAt: created.consent_at }));
  }
  const parsed = edit.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", 400);
  if (!row) return fail("consent_required", 403);
  if (row.revision !== parsed.data.revision || row.consent_at !== parsed.data.consentAt)
    return fail("conflict", 409);
  const { data: saved, error: saveError } = await client
    .from("account_profiles")
    .update({ profile: parsed.data.profile, revision: row.revision + 1 })
    .eq("user_id", user.id)
    .eq("revision", row.revision)
    .eq("consent_at", row.consent_at)
    .select("revision")
    .maybeSingle();
  if (saveError) return fail("save_failed", 503);
  if (!saved) return fail("conflict", 409);
  return finish(
    NextResponse.json({
      enabled: true,
      profile: parsed.data.profile,
      revision: saved.revision,
      consentAt: row.consent_at,
    }),
  );
}
export async function GET(r: NextRequest) {
  return handle(r);
}
export async function POST(r: NextRequest) {
  return handle(r);
}
export async function PUT(r: NextRequest) {
  return handle(r);
}
export async function DELETE(r: NextRequest) {
  return handle(r);
}
