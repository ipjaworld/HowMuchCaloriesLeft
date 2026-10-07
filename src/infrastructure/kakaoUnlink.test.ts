import { describe, expect, it, vi } from "vitest";
import { handleKakaoUnlink } from "../../supabase/functions/kakao-unlink/handler";

const validBody = "app_id=1599886&user_id=9007199254740993123&referrer_type=UNLINK_FROM_APPS";
function request(body = validBody, authorization = "KakaoAK test-secret") {
  return new Request("https://example.test/webhook", { method: "POST", body,
    headers: { authorization, "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } });
}
function dependencies() {
  return { adminKey: "test-secret", appId: "1599886", receive: vi.fn().mockResolvedValue(undefined), reportError: vi.fn() };
}
describe("Kakao unlink boundary", () => {
  it("authenticates and preserves long provider IDs without numeric rounding", async () => {
    const deps = dependencies();
    expect((await handleKakaoUnlink(request(), deps)).status).toBe(200);
    expect(deps.receive).toHaveBeenCalledWith("9007199254740993123");
  });
  it.each(["", "Bearer test-secret", "KakaoAK wrong-key"])("rejects invalid authorization %s", async (key) => {
    const deps = dependencies();
    expect((await handleKakaoUnlink(request(validBody, key), deps)).status).toBe(401);
    expect(deps.receive).not.toHaveBeenCalled();
  });
  it.each([
    validBody.replace("1599886", "1596220"),
    validBody + "&user_id=42",
    validBody.replace("9007199254740993123", "-1"),
    validBody.replace("UNLINK_FROM_APPS", "unknown"),
  ])("rejects invalid or ambiguous payload %s", async (body) => {
    const deps = dependencies();
    expect((await handleKakaoUnlink(request(body), deps)).status).toBe(400);
    expect(deps.receive).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies without trusting Content-Length", async () => {
    const deps = dependencies();
    expect((await handleKakaoUnlink(request(validBody + "&padding=" + "a".repeat(2048)), deps)).status).toBe(413);
    expect(deps.receive).not.toHaveBeenCalled();
  });
  it("acknowledges provider events on internal failure but emits an operational error without PII", async () => {
    const deps = dependencies();
    deps.receive.mockRejectedValue(new Error("private provider details"));
    expect((await handleKakaoUnlink(request(), deps)).status).toBe(200);
    expect(deps.reportError).toHaveBeenCalledWith();
  });
  it("fails closed when the configured key is absent", async () => {
    const deps = { ...dependencies(), adminKey: undefined };
    expect((await handleKakaoUnlink(request(), deps)).status).toBe(503);
    expect(deps.receive).not.toHaveBeenCalled();
  });
});
