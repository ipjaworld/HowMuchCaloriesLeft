import { NextRequest, NextResponse } from "next/server";
import {
  accountAuth,
  accountConfigured,
  sameOrigin,
} from "@/infrastructure/accountAuth";
import { env } from "@/env";
export async function GET(request: NextRequest) {
  if (!accountConfigured())
    return NextResponse.json(
      { configured: false, userId: null, providers: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  const { client, finish } = accountAuth(request);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (
    error &&
    error.name !== "AuthSessionMissingError" &&
    error.status !== 401 &&
    error.status !== 403
  )
    return finish(NextResponse.json({ error: "unavailable" }, { status: 503 }));
  return finish(
    NextResponse.json({
      configured: true,
      userId: user?.id ?? null,
      providers: env.ACCOUNT_PROVIDERS.split(","),
    }),
  );
}
export async function POST(request: NextRequest) {
  if (!accountConfigured())
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!sameOrigin(request))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, finish } = accountAuth(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || request.headers.get("x-account-id") !== user.id)
    return finish(
      NextResponse.json({ error: "account_changed" }, { status: 409 }),
    );
  const { error } = await client.auth.signOut({ scope: "local" });
  return finish(
    NextResponse.json(error ? { error: "logout_failed" } : { ok: true }, {
      status: error ? 503 : 200,
    }),
  );
}
export async function DELETE(request: NextRequest) {
  if (!accountConfigured())
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (
    !sameOrigin(request) ||
    request.headers.get("x-confirm-delete") !== "delete-my-account"
  )
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { client, finish } = accountAuth(request);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    return finish(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
  if (request.headers.get("x-account-id") !== user.id)
    return finish(
      NextResponse.json({ error: "account_changed" }, { status: 409 }),
    );
  const { error: deleted } = await client.rpc("delete_my_account");
  if (deleted)
    return finish(
      NextResponse.json({ error: "delete_failed" }, { status: 503 }),
    );
  await client.auth.signOut({ scope: "local" });
  return finish(NextResponse.json({ ok: true }));
}
