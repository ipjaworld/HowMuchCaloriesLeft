import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ enabled: true, configured: true, getUser: vi.fn(), signOut: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/env", () => ({ env: { ACCOUNT_PROVIDERS: "google,kakao", get ACCOUNT_RECOVERY_ENABLED() { return mock.enabled ? "on" : "off"; } } }));
vi.mock("@/infrastructure/accountAuth", () => ({
  accountConfigured: () => mock.configured,
  sameOrigin: (request: Request) => request.headers.get("origin") === "https://app.test",
  accountAuth: () => ({
    client: { auth: { getUser: mock.getUser, signOut: mock.signOut }, rpc: mock.rpc, from: mock.from },
    finish: (response: NextResponse) => { response.headers.set("Cache-Control", "private, no-store"); return response; },
  }),
}));
import { POST } from "./recovery/route";
import { GET as dataGET } from "./data/route";
import { GET as profileGET } from "./profile/route";
import { GET as accountGET } from "./route";
const body = { consent: true, profileConsent: false, disconnectedAt: "2026-10-07T00:00:00Z" };
function request(input: unknown = body, headers: Record<string, string> = {}) {
  return new NextRequest("https://app.test/api/account/recovery", { method: "POST",
    headers: { origin: "https://app.test", "x-account-id": "verified-user", ...headers }, body: JSON.stringify(input) });
}
beforeEach(() => {
  vi.clearAllMocks(); mock.enabled = true; mock.configured = true;
  mock.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
  mock.rpc.mockResolvedValue({ data: null, error: null });
});
describe("explicit recovery", () => {
  it("returns to sign-in when a revoked session still has an unexpired JWT", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await accountGET(new NextRequest("https://app.test/api/account"));
    expect(response.status).toBe(200);
    expect((await response.json()).userId).toBeNull();
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("is disabled until the separately gated policy is enabled", async () => {
    mock.enabled = false;
    expect((await POST(request())).status).toBe(503);
    expect(mock.getUser).not.toHaveBeenCalled();
  });
  it("rejects foreign origins before authentication", async () => {
    expect((await POST(request(body, { origin: "https://foreign.test" }))).status).toBe(403);
    expect(mock.getUser).not.toHaveBeenCalled();
  });
  it("requires a current session and matching account", async () => {
    expect((await POST(request(body, { "x-account-id": "someone-else" }))).status).toBe(409);
    mock.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...body, consent: false }, { ...body, userId: "someone-else" }, { ...body, profileConsent: undefined }])("requires bounded explicit consent without caller-supplied ownership", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("passes only the consent choices and generation to the caller-bound RPC", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("restore_my_account", { expected_disconnected_at: body.disconnectedAt, restore_profile: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([["22023",409],["42501",403],["08006",503]])("does not report restore success after DB rejection %s", async (code, status) => {
    mock.rpc.mockResolvedValue({ error: { code } });
    expect((await POST(request())).status).toBe(status);
  });
  it.each([dataGET,profileGET])("blocks suspended records instead of treating missing RLS rows as local mode", async (get) => {
    mock.rpc.mockResolvedValue({ data: { state: "pending" }, error: null });
    const response = await get(new NextRequest("https://app.test/api/account", { headers: { "x-account-id": "verified-user" } }));
    expect(response.status).toBe(423);
    expect(mock.from).not.toHaveBeenCalled();
  });
});
