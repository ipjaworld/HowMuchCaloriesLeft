import { NextRequest, NextResponse } from "next/server";
import {
  accountAuth,
  accountConfigured,
  sameOrigin,
} from "@/infrastructure/accountAuth";
import { signConsent } from "@/infrastructure/accountConsent";
import { env } from "@/env";
export async function POST(request: NextRequest) {
  if (!accountConfigured())
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!sameOrigin(request))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const provider = form.get("provider");
  if (
    (provider !== "google" && provider !== "kakao") ||
    !env.ACCOUNT_PROVIDERS.split(",").includes(provider) ||
    form.get("consent") !== "yes" ||
    form.get("age") !== "yes"
  )
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  const { client, finish } = accountAuth(request);
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: new URL("/api/auth/callback", env.APP_ORIGIN!).href,
      skipBrowserRedirect: true,
      // `scopes` appends to Kakao's default email/image permissions.
      // Override the provider's scope to request only our configured consent item.
      ...(provider === "kakao" ? { queryParams: { scope: "profile_nickname" } } : {}),
    },
  });
  if (error || !data.url)
    return finish(
      NextResponse.redirect(
        new URL("/account?error=login", env.APP_ORIGIN!),
        303,
      ),
    );
  const response = NextResponse.redirect(data.url, 303);
  response.cookies.set(
    "hmcl-account-consent",
    signConsent(env.RATE_LIMIT_SECRET!),
    {
      httpOnly: true,
      secure: new URL(env.APP_ORIGIN!).protocol === "https:",
      sameSite: "lax",
      maxAge: 900,
      path: "/api/auth/callback",
    },
  );
  return finish(response);
}
