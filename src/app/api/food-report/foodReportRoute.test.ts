import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeFoodReport } from "@/application/foodReport";
import { UsageLimitExceeded } from "@/domain/rateLimit";
import { FOOD_REPORT_COUNTS_KEY, FOOD_REPORT_LAST_KEY } from "@/infrastructure/foodReportStore";
import { describeReported, REPORT_FOOD, withReportOption, type Reply } from "@/components/replyText";

const mocks = vi.hoisted(() => ({
  enabled: true,
  checkRequest: vi.fn(),
  beforeFoodReport: vi.fn(),
  add: vi.fn(),
}));
vi.mock("@/infrastructure/serverUsageLimits", () => ({
  usageLimits: mocks,
  requestIdentity: () => "hashed",
  foodReportEnabled: () => mocks.enabled,
  sharedStore: () => ({ url: "https://store.test", token: "t" }),
}));
vi.mock("@/infrastructure/foodReportStore", async (original) => ({
  ...(await original<typeof import("@/infrastructure/foodReportStore")>()),
  createUpstashFoodReportStore: () => ({ add: mocks.add }),
}));

const { POST } = await import("./route");
// The real store, not the stand-in the route is given above.
const { createUpstashFoodReportStore } = await vi.importActual<typeof import("@/infrastructure/foodReportStore")>("@/infrastructure/foodReportStore");
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/food-report", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  mocks.enabled = true;
  mocks.checkRequest.mockReset().mockResolvedValue({ allowed: true });
  mocks.beforeFoodReport.mockReset().mockResolvedValue(undefined);
  mocks.add.mockReset().mockResolvedValue(undefined);
});

describe("/api/food-report", () => {
  it("does not exist while reports are off", async () => {
    mocks.enabled = false;
    expect((await post({ name: "파김치" })).status).toBe(404);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("keeps the name and nothing else from the request", async () => {
    const response = await post({ name: "  비빔   막국수 ", sentence: "어제 친구랑 비빔 막국수 먹었어", userId: "u1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reported: true });
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add.mock.calls[0]?.[0]).toBe("비빔 막국수");
    // Only the name and the time go to the store: never the identity used for the limit.
    expect(mocks.add.mock.calls[0]).toHaveLength(2);
    expect(JSON.stringify(mocks.add.mock.calls)).not.toContain("hashed");
    expect(mocks.checkRequest).toHaveBeenCalledWith("report", "hashed");
  });

  it("refuses a body that is not a food name before spending a limit", async () => {
    expect((await post("{")).status).toBe(400);
    for (const name of [undefined, 12, "", "가".repeat(31), "<script>", "12345", "https://a.kr", "문의 01012345678"])
      expect((await post({ name })).status, String(name)).toBe(400);
    expect(mocks.checkRequest).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("answers 429 for the per-browser limit and the service's daily cap", async () => {
    mocks.checkRequest.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const limited = await post({ name: "파김치" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    mocks.checkRequest.mockResolvedValue({ allowed: true });
    mocks.beforeFoodReport.mockRejectedValue(new UsageLimitExceeded(600));
    const capped = await post({ name: "파김치" });
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "report_daily_limit" });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("says so when the report could not be kept", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.add.mockRejectedValue(new Error("status 500"));
      const response = await post({ name: "파김치" });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "report_unavailable" });
    } finally {
      log.mockRestore();
    }
  });
});

describe("a reported name", () => {
  it("is trimmed, collapsed and kept as said", () => {
    expect(normalizeFoodReport(" 파김치 1종지 ")).toBe("파김치 1종지");
    expect(normalizeFoodReport("뚱카롱")).toBe("뚱카롱");
    expect(normalizeFoodReport("Greek yogurt (plain)")).toBe("Greek yogurt (plain)");
    expect(normalizeFoodReport("가".repeat(30))).toHaveLength(30);
  });
});

describe("the store", () => {
  it("counts the name and notes the KST day, in one transaction", async () => {
    const fetcher = vi.fn(async () => Response.json([{ result: "3" }, { result: 0 }]));
    const store = createUpstashFoodReportStore({ url: "https://store.test/", token: "secret", fetcher: fetcher as unknown as typeof fetch });
    // 2026-11-10 23:30 UTC is already the 11th in Korea.
    await store.add("파김치", new Date("2026-11-10T23:30:00.000Z"));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://store.test/multi-exec");
    expect(JSON.parse(init.body as string)).toEqual([
      ["ZINCRBY", FOOD_REPORT_COUNTS_KEY, "1", "파김치"],
      ["HSET", FOOD_REPORT_LAST_KEY, "파김치", "2026-11-11"],
    ]);
  });

  it("rejects when the store answers with an error, so nobody is thanked for nothing", async () => {
    const failing = (response: Response) =>
      createUpstashFoodReportStore({ url: "https://store.test", token: "t", fetcher: (async () => response) as unknown as typeof fetch }).add("파김치", new Date());
    await expect(failing(new Response("no", { status: 500 }))).rejects.toThrow();
    await expect(failing(Response.json([{ error: "ERR" }, { result: 0 }]))).rejects.toThrow();
    await expect(failing(Response.json({ result: 1 }))).rejects.toThrow();
  });
});

describe("the question after a report", () => {
  const question: Reply = {
    kind: "question",
    text: "파김치는 아직 정보가 없어요. 대략 몇 kcal였는지 알려주시면 그대로 적을게요.",
    options: [{ id: "skip", label: "빼고 기록" }],
  };

  it("adds the button beside the existing answers", () => {
    const offered = withReportOption(question);
    expect(offered.kind === "question" && offered.options.map((option) => option.label)).toEqual(["빼고 기록", "제보하기"]);
    expect(withReportOption({ kind: "statement", text: "x" })).toEqual({ kind: "statement", text: "x" });
  });

  it("still asks for the calories, without a promise of when", () => {
    const sent = describeReported(withReportOption(question), "sent");
    expect(sent).toEqual({
      kind: "question",
      text: "제보했어요. 추가할 수 있는지 확인해 볼게요. 대략 몇 kcal였는지 알려주시면 그대로 적을게요.",
      options: [{ id: "skip", label: "빼고 기록" }],
    });
    expect(sent.text).not.toMatch(/빠른|곧|반영하겠/);
  });

  it("keeps the button when this browser is only being slowed down", () => {
    const busy = describeReported(withReportOption(question), "busy");
    expect(busy.kind === "question" && busy.options.map((option) => option.id)).toEqual(["skip", REPORT_FOOD]);
    expect(busy.text).toContain("잠시 후 다시");
    expect(busy.text).not.toContain("오늘은");
  });

  it("keeps the button after a failed send and removes it at the daily limit", () => {
    const failed = describeReported(withReportOption(question), "failed");
    expect(failed.kind === "question" && failed.options.map((option) => option.id)).toEqual(["skip", REPORT_FOOD]);
    expect(failed.text).toContain("제보를 보내지 못했어요");
    const limited = describeReported(withReportOption(question), "limited");
    expect(limited.kind === "question" && limited.options.map((option) => option.id)).toEqual(["skip"]);
  });
});
