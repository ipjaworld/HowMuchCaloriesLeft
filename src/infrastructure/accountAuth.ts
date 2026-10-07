import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

export function accountConfigured() {
  return (
    env.ACCOUNT_ENABLED === "on" &&
    !!env.SUPABASE_URL &&
    !!env.SUPABASE_PUBLISHABLE_KEY &&
    !!env.APP_ORIGIN &&
    !!env.PRIVACY_OPERATOR &&
    !!env.PRIVACY_CONTACT_EMAIL &&
    !!env.RATE_LIMIT_SECRET
  );
}
export function sameOrigin(request: Request) {
  return (
    !!env.APP_ORIGIN &&
    request.headers.get("origin") === new URL(env.APP_ORIGIN).origin
  );
}
/** Route-only session adapter: no proxy or browser token storage is needed. */
export function accountAuth(request: NextRequest) {
  if (!accountConfigured())
    throw new Error("Account service is not configured");
  const pending: Parameters<
    NonNullable<Parameters<typeof createServerClient>[2]["cookies"]["setAll"]>
  >[0] = [];
  const client = createServerClient(
    env.SUPABASE_URL!,
    env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: new URL(env.APP_ORIGIN!).protocol === "https:",
        path: "/",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          pending.push(...cookies);
          for (const c of cookies) request.cookies.set(c.name, c.value);
        },
      },
    },
  );
  function finish(response: NextResponse) {
    for (const c of pending) response.cookies.set(c.name, c.value, c.options);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Pragma", "no-cache");
    return response;
  }
  return { client, finish };
}
