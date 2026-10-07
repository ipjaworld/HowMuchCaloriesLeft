import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  configured: true,
  getUser: vi.fn(),
  checkRequest: vi.fn(),
}));
vi.mock("@/env", () => ({ env: { RATE_LIMIT_SECRET: "test-only-secret" } }));
vi.mock("./accountAuth", () => ({
  accountConfigured: () => mock.configured,
  accountAuth: () => ({
    client: { auth: { getUser: mock.getUser } },
    finish: (r: Response) => r,
  }),
}));
vi.mock("./serverUsageLimits", () => ({
  usageLimits: { checkRequest: mock.checkRequest },
}));
import { checkAccountUsage } from "./accountUsageLimits";
beforeEach(() => {
  vi.clearAllMocks();
  mock.configured = true;
  mock.checkRequest.mockResolvedValue({ allowed: true });
});
describe("optional account limits", () => {
  it("does not authenticate the existing disabled-feature path", async () => {
    mock.configured = false;
    expect(
      (await checkAccountUsage(new Request("https://app.test"), "chat"))
        .rejection,
    ).toBeNull();
    expect(mock.getUser).not.toHaveBeenCalled();
  });
  it("counts verified accounts without storing the raw ID", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: { id: "private-user-id" } },
      error: null,
    });
    await checkAccountUsage(new Request("https://app.test"), "chat");
    expect(mock.checkRequest).toHaveBeenCalledWith(
      "chat",
      expect.stringMatching(/^account:[a-f0-9]{64}$/),
    );
    expect(JSON.stringify(mock.checkRequest.mock.calls)).not.toContain(
      "private-user-id",
    );
  });
  it("returns the additional account limit with retry information", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: { id: "user" } },
      error: null,
    });
    mock.checkRequest.mockResolvedValue({ allowed: false, retryAfter: 20 });
    const result = await checkAccountUsage(
      new Request("https://app.test"),
      "resolve",
    );
    expect(result.rejection?.status).toBe(429);
    expect(result.rejection?.headers.get("Retry-After")).toBe("20");
  });
  it("does not fall back to an uncounted account on an authentication outage", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503 },
    });
    expect(
      (await checkAccountUsage(new Request("https://app.test"), "chat"))
        .rejection?.status,
    ).toBe(503);
    expect(mock.checkRequest).not.toHaveBeenCalled();
  });
});
