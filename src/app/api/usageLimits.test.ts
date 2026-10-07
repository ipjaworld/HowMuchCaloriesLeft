import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitExceeded } from "@/domain/rateLimit";
const mocks = vi.hoisted(() => ({ checkRequest: vi.fn(), beforeJevCall: vi.fn(), runChat: vi.fn() }));
vi.mock("@/infrastructure/serverUsageLimits", () => ({ usageLimits: mocks, requestIdentity: () => "hashed" }));
vi.mock("@/application/chatPipeline", () => ({ runChat: mocks.runChat }));
vi.mock("@/env", () => ({ env: { TYPESAFE_API_KEY: undefined } }));
import { POST as chat } from "./chat/route";
import { POST as resolve } from "./resolve/route";
const body = { message: "커피", now: "2026-10-07T12:00:00+09:00", dailyGoalCalories: null, recentItems: [] };
const request = (value: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); mocks.checkRequest.mockResolvedValue({ allowed: true }); mocks.runChat.mockResolvedValue({ command: { type: "answer", kind: "status" } }); });
describe("limited routes", () => {
  it.each(["chat", "resolve"])("returns 429, Retry-After and an error code for %s", async (route) => {
    mocks.checkRequest.mockResolvedValue({ allowed: false, retryAfter: 19 });
    const response = await (route === "chat" ? chat(request(body)) : resolve(request({ foodName: "커피", amountText: "200ml" })));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(response.headers.get("Retry-After")).toBe("19");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.runChat).not.toHaveBeenCalled();
    expect(mocks.checkRequest).toHaveBeenCalledWith(route, "hashed");
  });
  it("keeps Jev cap distinct from upstream failures", async () => {
    mocks.runChat.mockRejectedValue(new UsageLimitExceeded(3600));
    const response = await chat(request(body));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "jev_daily_limit" });
    expect(response.headers.get("Retry-After")).toBe("3600");
  });
  it("retains the existing 503 contract", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.runChat.mockRejectedValue(new Error("offline"));
      const response = await chat(request(body));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "judgment_unavailable" });
    } finally { log.mockRestore(); }
  });
  it.each([chat, resolve])("retains 400 validation before admission", async (route) => {
    const malformed = await route(new Request("http://localhost/api", { method: "POST", body: "{" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_json" });
    const invalid = await route(request({}));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_request" });
    expect(mocks.checkRequest).not.toHaveBeenCalled();
  });
});
