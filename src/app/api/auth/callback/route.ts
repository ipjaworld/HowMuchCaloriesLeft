import { NextRequest, NextResponse } from "next/server";
import { accountAuth, accountConfigured } from "@/infrastructure/accountAuth";
import { validConsent } from "@/infrastructure/accountConsent";
import { env } from "@/env";
import { ACCOUNT_POLICY_VERSION, emptyAccountData } from "@/domain/account";
import { readAccountRecovery } from "@/infrastructure/accountRecovery";
export async function GET(request: NextRequest) {
  if (!accountConfigured())
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const { client, finish } = accountAuth(request);
  const failure = () =>
    finish(
      NextResponse.redirect(new URL("/account?error=login", env.APP_ORIGIN!)),
    );
  const code = request.nextUrl.searchParams.get("code");
  if (
    !code ||
    !validConsent(
      request.cookies.get("hmcl-account-consent")?.value,
      env.RATE_LIMIT_SECRET!,
    )
  )
    return failure();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return failure();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (!user || userError) {
    await client.auth.signOut({ scope: "local" });
    return failure();
  }
  // A fresh OAuth session may only open the recovery screen, not the records.
  try {
    const recovery = await readAccountRecovery(client);
    if (recovery.state !== "active") {
      const response = NextResponse.redirect(new URL("/account", env.APP_ORIGIN!));
      response.cookies.set("hmcl-account-consent", "", { maxAge: 0, path: "/api/auth/callback" });
      return finish(response);
    }
  } catch {
    await client.auth.signOut({ scope: "local" });
    return failure();
  }
  const { error: saveError } = await client
    .from("account_data")
    .upsert(
      {
        user_id: user.id,
        data: emptyAccountData(),
        consent_version: ACCOUNT_POLICY_VERSION,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (saveError) {
    await client.auth.signOut({ scope: "local" });
    return failure();
  }
  const response = NextResponse.redirect(
    new URL("/account?welcome=1", env.APP_ORIGIN!),
  );
  response.cookies.set("hmcl-account-consent", "", {
    maxAge: 0,
    path: "/api/auth/callback",
  });
  return finish(response);
}
