import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signConsent } from "@/infrastructure/accountConsent";
const mock = vi.hoisted(() => ({ exchange: vi.fn(), user: vi.fn(), out: vi.fn(), oauth: vi.fn(), upsert: vi.fn() }));
vi.mock("@/env", () => ({ env: { APP_ORIGIN: "https://app.test", RATE_LIMIT_SECRET: "test-secret", ACCOUNT_PROVIDERS: "google,kakao" } }));
vi.mock("@/infrastructure/accountAuth", () => ({
  accountConfigured: () => true,
  sameOrigin: (r: Request) => r.headers.get("origin") === "https://app.test",
  accountAuth: () => ({ client: { auth: { exchangeCodeForSession: mock.exchange, getUser: mock.user, signOut: mock.out, signInWithOAuth: mock.oauth }, from: () => ({ upsert: mock.upsert }) }, finish: (r: Response) => r }),
}));
import { GET } from "./callback/route";
import { POST } from "./start/route";
beforeEach(() => { vi.clearAllMocks(); mock.exchange.mockResolvedValue({ error: null }); mock.user.mockResolvedValue({ data: { user: { id: "user" } }, error: null }); mock.upsert.mockResolvedValue({ error: null }); mock.out.mockResolvedValue({ error: null }); });
function callback(consent?: string) { return new NextRequest("https://app.test/api/auth/callback?code=verified-by-sdk", { headers: consent ? { cookie: `hmcl-account-consent=${consent}` } : {} }); }
it.each([undefined,"forged-consent"])("rejects callback without signed age/consent proof: %s", async proof => {
  const result = await GET(callback(proof)); expect(result.headers.get("location")).toBe("https://app.test/account?error=login"); expect(mock.exchange).not.toHaveBeenCalled();
});
it("preserves existing records when an established account signs in again", async () => {
  const result = await GET(callback(signConsent("test-secret")));
  expect(mock.upsert.mock.calls[0]?.[1]).toEqual({ onConflict: "user_id", ignoreDuplicates: true });
  expect(result.headers.get("location")).toBe("https://app.test/account?welcome=1");
  expect(result.cookies.get("hmcl-account-consent")?.value).toBe("");
});
it("clears the session when consent/initial storage cannot be saved", async () => {
  mock.upsert.mockResolvedValue({ error: { message: "offline" } });
  expect((await GET(callback(signConsent("test-secret")))).headers.get("location")).toContain("error=login");
  expect(mock.out).toHaveBeenCalledWith({ scope: "local" });
});
it("requires age and consent before starting OAuth", async () => {
  const form = new URLSearchParams({ provider: "google", age: "yes" });
  const result = await POST(new NextRequest("https://app.test/api/auth/start", { method: "POST", headers: { origin: "https://app.test" }, body: form }));
  expect(result.status).toBe(400); expect(mock.oauth).not.toHaveBeenCalled();
});
it("starts Kakao with only the nickname scope and a fixed callback", async () => {
  mock.oauth.mockResolvedValue({ data: { url: "https://provider.test/auth" }, error: null });
  const body = new URLSearchParams({ provider: "kakao", age: "yes", consent: "yes" });
  const result = await POST(new NextRequest("https://app.test/api/auth/start", { method: "POST", headers: { origin: "https://app.test" }, body }));
  expect(result.status).toBe(303);
  expect(mock.oauth).toHaveBeenCalledWith({ provider: "kakao", options: { redirectTo: "https://app.test/api/auth/callback", skipBrowserRedirect: true, scopes: "profile_nickname" } });
  expect(result.cookies.get("hmcl-account-consent")?.httpOnly).toBe(true);
});
