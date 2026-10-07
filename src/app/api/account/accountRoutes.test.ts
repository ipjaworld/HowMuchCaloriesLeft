import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { emptyAccountData } from "@/domain/account";

const mocks = vi.hoisted(() => ({
  configured: true,
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/infrastructure/accountAuth", () => ({
  accountConfigured: () => mocks.configured,
  sameOrigin: (r: Request) => r.headers.get("origin") === "https://app.test",
  accountAuth: () => ({
    client: {
      auth: { getUser: mocks.getUser, signOut: mocks.signOut },
      from: mocks.from,
      rpc: mocks.rpc,
    },
    finish: (r: NextResponse) => {
      r.headers.set("Cache-Control", "private, no-store");
      return r;
    },
  }),
}));
import * as data from "./data/route";
import * as profile from "./profile/route";
import * as account from "./route";

function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest("https://app.test/api/account", {
    method,
    headers: {
      origin: "https://app.test",
      "x-account-id": "user-a",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function query(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  for (const method of [chain.select, chain.eq, chain.update, chain.delete])
    method.mockReturnValue(chain);
  chain.single.mockResolvedValue(result);
  chain.maybeSingle.mockResolvedValue(result);
  chain.insert.mockResolvedValue(result);
  return chain;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user-a" } },
    error: null,
  });
});
describe("account API authorization", () => {
  it.each([
    data.POST,
    profile.POST,
    profile.PUT,
    profile.DELETE,
    account.POST,
    account.DELETE,
  ])(
    "rejects foreign origins before authentication or storage",
    async (handler) => {
      const response = await handler(
        request("POST", {}, { origin: "https://foreign.test" }),
      );
      expect(response.status).toBe(403);
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it.each([data.GET, profile.GET])(
    "rejects missing sessions",
    async (handler) => {
      mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
      expect((await handler(request("GET"))).status).toBe(401);
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it.each([data.GET, profile.GET])(
    "rejects an old tab after an account switch",
    async (handler) => {
      expect(
        (await handler(request("GET", undefined, { "x-account-id": "user-b" })))
          .status,
      ).toBe(409);
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it("requires explicit deletion confirmation", async () => {
    expect((await account.DELETE(request("DELETE"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses only the authenticated deletion RPC, without caller-supplied user IDs", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    expect(
      (
        await account.DELETE(
          request("DELETE", undefined, {
            "x-confirm-delete": "delete-my-account",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_my_account");
  });
  it("fails closed while the feature is disabled", async () => {
    mocks.configured = false;
    expect((await data.GET(request("GET"))).status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
describe("account mutations", () => {
  it("does not overwrite a newer revision", async () => {
    const read = query({
      data: { data: emptyAccountData(), revision: 2 },
      error: null,
    });
    mocks.from.mockReturnValue(read);
    expect(
      (
        await data.POST(
          request("POST", { operation: "remove", id: "record", revision: 1 }),
        )
      ).status,
    ).toBe(409);
    expect(read.update).not.toHaveBeenCalled();
  });
  it("detects a writer winning between the read and update", async () => {
    const read = query({
      data: { data: emptyAccountData(), revision: 2 },
      error: null,
    });
    const write = query({ data: null, error: null });
    mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(write);
    expect(
      (
        await data.POST(
          request("POST", { operation: "remove", id: "record", revision: 2 }),
        )
      ).status,
    ).toBe(409);
    expect(write.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(write.eq).toHaveBeenCalledWith("revision", 2);
  });
  it("rejects import without separate consent", async () => {
    const read = query({
      data: { data: emptyAccountData(), revision: 0 },
      error: null,
    });
    mocks.from.mockReturnValue(read);
    expect(
      (
        await data.POST(
          request("POST", {
            operation: "import",
            data: emptyAccountData(),
            revision: 0,
          }),
        )
      ).status,
    ).toBe(400);
    expect(read.update).not.toHaveBeenCalled();
  });
});
describe("separate calculator consent", () => {
  const value = {
    weightKg: 60,
    heightCm: 170,
    age: 30,
    sex: "male",
    activityLevel: "sedentary",
    goalMode: "maintenance",
    updatedAt: "2026-10-07T00:00:00Z",
  };
  it("does not create a profile when consent is absent", async () => {
    const read = query({ data: null, error: null });
    mocks.from.mockReturnValue(read);
    expect(
      (await profile.POST(request("POST", { profile: value }))).status,
    ).toBe(400);
    expect(read.insert).not.toHaveBeenCalled();
  });
  it("does not re-enable profile storage through an ordinary save after withdrawal", async () => {
    const read = query({ data: null, error: null });
    mocks.from.mockReturnValue(read);
    expect(
      (await profile.PUT(request("PUT", { profile: value, revision: 0 })))
        .status,
    ).toBe(403);
    expect(read.update).not.toHaveBeenCalled();
  });
  it("reports a concurrent change during withdrawal", async () => {
    const read = query({ data: { profile: value, revision: 2 }, error: null });
    const remove = query({ data: null, error: null });
    mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(remove);
    expect(
      (
        await profile.DELETE(
          request("DELETE", undefined, { "x-revision": "2" }),
        )
      ).status,
    ).toBe(409);
  });
});
