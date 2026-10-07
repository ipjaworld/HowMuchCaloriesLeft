import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { signConsent } from "@/infrastructure/accountConsent";
import { emptyAccountData } from "@/domain/account";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(),
  signOut: vi.fn(), from: vi.fn(), upsert: vi.fn(),
}));
vi.mock("@/env", () => ({ env: {
  ACCOUNT_PROVIDERS: "google,kakao", APP_ORIGIN: "https://app.test", RATE_LIMIT_SECRET: "test-only-secret",
} }));
vi.mock("@/infrastructure/accountAuth", () => ({
  accountConfigured: () => true,
  sameOrigin: (request: Request) => request.headers.get("origin") === "https://app.test",
  accountAuth: () => ({
    client: { auth: mocks, from: mocks.from },
    finish: (response: NextResponse) => {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  }),
}));
import { POST } from "./start/route";
import { GET } from "./callback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInWithOAuth.mockResolvedValue({ data: { url: "https://provider.test/authorize" }, error: null });
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ upsert: mocks.upsert });
  mocks.upsert.mockResolvedValue({ error: null });
});
function callback(cookie = signConsent("test-only-secret")) {
  return new NextRequest("https://app.test/api/auth/callback?code=pkce-code&next=https://evil.test", {
    headers: cookie ? { cookie: `hmcl-account-consent=${cookie}` } : {},
  });
}
describe("OAuth route boundaries", () => {
  it.each(["age", "consent"])("requires explicit %s before contacting the provider", async (missing) => {
    const body = new URLSearchParams({ provider: "google", consent: "yes", age: "yes" });
    body.delete(missing);
    const response = await POST(new NextRequest("https://app.test/api/auth/start", {
      method: "POST", headers: { origin: "https://app.test" },
      body,
    }));
    expect(response.status).toBe(400);
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });
  it("uses the fixed callback and minimal Kakao scope, and signs an HttpOnly consent cookie", async () => {
    const response = await POST(new NextRequest("https://app.test/api/auth/start", {
      method: "POST", headers: { origin: "https://app.test" },
      body: new URLSearchParams({ provider: "kakao", consent: "yes", age: "yes", next: "https://evil.test" }),
    }));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({ provider: "kakao", options: {
      redirectTo: "https://app.test/api/auth/callback", skipBrowserRedirect: true, scopes: "profile_nickname",
    } });
    expect(response.status).toBe(303);
    expect(response.cookies.get("hmcl-account-consent")).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 900 });
  });
  it.each(["", "forged"])("does not exchange a code without valid consent: %s", async (cookie) => {
    const response = await GET(callback(cookie));
    expect(response.headers.get("location")).toBe("https://app.test/account?error=login");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("never creates or overwrites account records after a failed code exchange", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid code") });
    await GET(callback());
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("uses the verified user and preserves existing data on repeated login", async () => {
    const response = await GET(callback());
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "verified-user", data: emptyAccountData(),
    }), { onConflict: "user_id", ignoreDuplicates: true });
    expect(response.headers.get("location")).toBe("https://app.test/account?welcome=1");
    expect(response.cookies.get("hmcl-account-consent")?.maxAge).toBe(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("clears the new session if account initialization fails", async () => {
    mocks.upsert.mockResolvedValue({ error: new Error("database unavailable") });
    const response = await GET(callback());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe("https://app.test/account?error=login");
  });
});
