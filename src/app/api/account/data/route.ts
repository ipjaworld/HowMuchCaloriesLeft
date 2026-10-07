import { NextRequest, NextResponse } from "next/server";
import {
  accountAuth,
  accountConfigured,
  sameOrigin,
} from "@/infrastructure/accountAuth";
import {
  accountDataSchema,
  accountMutationSchema,
} from "@/infrastructure/accountSchemas";
import { mutateAccountData } from "@/application/accountMutation";
import { retainedTurns } from "@/domain/conversation";
import { todayKey } from "@/domain/date";

async function handle(request: NextRequest, write: boolean) {
  if (!accountConfigured())
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (write && !sameOrigin(request))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, finish } = accountAuth(request);
  const fail = (error: string, status: number) =>
    finish(NextResponse.json({ error }, { status }));
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) return fail("unauthorized", 401);
  if (request.headers.get("x-account-id") !== user.id)
    return fail("account_changed", 409);
  const { data: row, error } = await client
    .from("account_data")
    .select("data,revision")
    .eq("user_id", user.id)
    .single();
  if (error || !row) return fail("read_failed", 503);
  const parsed = accountDataSchema.safeParse(row.data);
  if (!parsed.success) return fail("invalid_stored_data", 503);
  const current = parsed.data;
  current.turns = retainedTurns(current.turns, todayKey());
  if (!write)
    return finish(NextResponse.json({ data: current, revision: row.revision }));
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4_000_000)
      return fail("too_large", 413);
    raw = JSON.parse(text);
  } catch {
    return fail("invalid_json", 400);
  }
  const mutation = accountMutationSchema.safeParse(raw);
  if (!mutation.success) return fail("invalid_request", 400);
  if (mutation.data.revision !== row.revision) return fail("conflict", 409);
  const next = mutateAccountData(current, mutation.data, new Date());
  if (
    !accountDataSchema.safeParse(next).success ||
    new TextEncoder().encode(JSON.stringify(next)).length > 4_000_000
  )
    return fail("too_large", 413);
  const { data: saved, error: writeError } = await client
    .from("account_data")
    .update({ data: next, revision: row.revision + 1 })
    .eq("user_id", user.id)
    .eq("revision", row.revision)
    .select("revision")
    .maybeSingle();
  if (writeError) return fail("save_failed", 503);
  if (!saved) return fail("conflict", 409);
  return finish(NextResponse.json({ data: next, revision: saved.revision }));
}
export async function GET(request: NextRequest) {
  return handle(request, false);
}
export async function POST(request: NextRequest) {
  return handle(request, true);
}
