import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitExceeded } from "@/domain/rateLimit";
import { isJpeg, PHOTO_MAX_BYTES, PHOTO_MAX_ITEMS, photoResult } from "@/application/photoCandidates";
import { createUsageLimits } from "@/application/usageLimits";
import { envSchema } from "@/env";
import { createMemoryRateLimiter } from "@/infrastructure/memoryRateLimiter";
import { PHOTO_NOTICE, photoOutcome } from "@/components/photoInput";

const mocks = vi.hoisted(() => ({
  enabled: true,
  checkRequest: vi.fn(),
  beforePhotoCall: vi.fn(),
  recognize: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/env", async (original) => ({
  ...(await original<typeof import("@/env")>()),
  env: { ANTHROPIC_API_KEY: "test-key", PHOTO_MODEL: "model", PHOTO_TIMEOUT_MS: 1000 },
  get photoInputEnabled() { return mocks.enabled; },
}));
vi.mock("@/infrastructure/serverUsageLimits", () => ({ usageLimits: mocks, requestIdentity: () => "hashed" }));
vi.mock("@/ai/photo/recognizer", () => ({
  createPhotoRecognizer: (options: unknown) => { mocks.create(options); return mocks.recognize; },
}));

const { POST } = await import("./route");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const post = (body: Uint8Array, type = "image/jpeg", headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/photo", { method: "POST", body: body as BodyInit, headers: { "Content-Type": type, ...headers } }));

beforeEach(() => {
  mocks.enabled = true;
  mocks.checkRequest.mockReset().mockResolvedValue({ allowed: true });
  mocks.beforePhotoCall.mockReset().mockResolvedValue(undefined);
  mocks.recognize.mockReset().mockResolvedValue({
    kind: "food",
    items: [{ name: "김치찌개", amount: "1그릇" }, { name: "쌀밥", amount: "1공기" }],
  });
});

describe("/api/photo", () => {
  it("does not exist while photo input is off", async () => {
    mocks.enabled = false;
    const response = await post(JPEG);
    expect(response.status).toBe(404);
    expect(mocks.checkRequest).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it("turns a reading into one sentence and nothing else", async () => {
    const response = await post(JPEG);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "food", sentence: "김치찌개 1그릇, 쌀밥 1공기", count: 2, assumedOne: [] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.checkRequest).toHaveBeenCalledWith("photo", "hashed");
    expect(mocks.recognize).toHaveBeenCalledWith(Buffer.from(JPEG).toString("base64"));
  });

  it("refuses anything that is not a small JPEG before spending a limit or a call", async () => {
    expect((await post(JPEG, "image/png")).status).toBe(415);
    expect((await post(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]))).status).toBe(400);
    expect((await post(new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(JPEG);
    expect((await post(big)).status).toBe(413);
    expect((await post(JPEG, "image/jpeg", { "Content-Length": String(PHOTO_MAX_BYTES + 1) })).status).toBe(413);
    expect(mocks.checkRequest).not.toHaveBeenCalled();
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it("answers 429 for the per-browser limit and for the service's daily cap, without calling the model", async () => {
    mocks.checkRequest.mockResolvedValue({ allowed: false, retryAfter: 40 });
    const limited = await post(JPEG);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(limited.headers.get("Retry-After")).toBe("40");
    expect(mocks.beforePhotoCall).not.toHaveBeenCalled();

    mocks.checkRequest.mockResolvedValue({ allowed: true });
    mocks.beforePhotoCall.mockRejectedValue(new UsageLimitExceeded(3600));
    const capped = await post(JPEG);
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "photo_daily_limit" });
    expect(mocks.recognize).not.toHaveBeenCalled();
  });

  it("answers 503 when the reading fails, and logs no part of the error body", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.recognize.mockRejectedValue(Object.assign(new Error("secret payload echo"), { status: 529 }));
      const response = await post(JPEG);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "photo_unavailable" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload echo");
    } finally {
      log.mockRestore();
    }
  });

  it("passes non-food and unreadable photos through as such", async () => {
    mocks.recognize.mockResolvedValue({ kind: "not_food", items: [] });
    expect(await (await post(JPEG)).json()).toEqual({ kind: "not_food" });
    mocks.recognize.mockResolvedValue({ kind: "unreadable", items: [] });
    expect(await (await post(JPEG)).json()).toEqual({ kind: "unreadable" });
  });
});

describe("what a reading may become", () => {
  it("never carries an energy or nutrient figure into the sentence", () => {
    const result = photoResult({
      kind: "food",
      items: [
        { name: "라면", amount: "1봉지 500kcal" },
        { name: "콜라 140kcal", amount: "1캔" },
        { name: "김밥", amount: "약 300 칼로리" },
        { name: "닭가슴살", amount: "단백질 23g" },
      ],
    });
    expect(result).toEqual({ kind: "food", sentence: "라면, 김밥, 닭가슴살", count: 3, assumedOne: [] });
  });

  it("keeps a printed volume, drops separators, duplicates, blanks and overlong text", () => {
    const result = photoResult({
      kind: "food",
      items: [
        { name: " 제로 콜라 ", amount: "355ml" },
        { name: "제로 콜라", amount: "355ml" },
        { name: "", amount: "1개" },
        { name: "샐러드,\n드레싱", amount: "" },
        { name: "가".repeat(31), amount: "1개" },
        { name: "빵", amount: "아주 길게 늘어놓은 설명이라서 양이라고 볼 수 없는 문장" },
      ],
    });
    expect(result).toEqual({ kind: "food", sentence: "제로 콜라 355ml, 샐러드 드레싱, 빵", count: 3, assumedOne: [] });
  });

  it("names the foods written as one of several, and only those that made it into the sentence", () => {
    const result = photoResult({
      kind: "food",
      items: [
        { name: "뚱카롱", amount: "1개", one_of_several: true },
        { name: "아메리카노", amount: "1잔", one_of_several: false },
        { name: "500kcal 케이크", amount: "1조각", one_of_several: true },
      ],
    });
    expect(result).toEqual({ kind: "food", sentence: "뚱카롱 1개, 아메리카노 1잔", count: 2, assumedOne: ["뚱카롱"] });
  });

  it("caps the number of foods and treats an empty food reading as unreadable", () => {
    const many = photoResult({
      kind: "food",
      items: Array.from({ length: 12 }, (_, index) => ({ name: `반찬${index}`, amount: "" })),
    });
    expect(many.kind === "food" && many.count).toBe(PHOTO_MAX_ITEMS);
    expect(photoResult({ kind: "food", items: [] })).toEqual({ kind: "unreadable" });
    expect(photoResult({ kind: "food", items: [{ name: "500kcal", amount: "" }] })).toEqual({ kind: "unreadable" });
    expect(photoResult({ kind: "not_food", items: [{ name: "김밥", amount: "" }] })).toEqual({ kind: "not_food" });
  });

  it("recognises a JPEG by its first bytes", () => {
    expect(isJpeg(JPEG)).toBe(true);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(new TextEncoder().encode("<svg onload=alert(1)>"))).toBe(false);
  });
});

describe("what the browser says about each answer", () => {
  it("fills the box only for a food sentence", () => {
    expect(photoOutcome(200, { kind: "food", sentence: "김밥 1줄", count: 1 })).toEqual({ kind: "filled", sentence: "김밥 1줄", note: PHOTO_NOTICE.read });
    expect(photoOutcome(200, { kind: "food", sentence: "김밥 1줄", count: 1, assumedOne: [] })).toEqual({ kind: "filled", sentence: "김밥 1줄", note: PHOTO_NOTICE.read });
    // Several were in the photo: the note says one was written and to set the number.
    const several = photoOutcome(200, { kind: "food", sentence: "뚱카롱 1개", count: 1, assumedOne: ["뚱카롱"] });
    expect(several).toEqual({ kind: "filled", sentence: "뚱카롱 1개", note: "사진으로는 먹은 양을 알 수 없어 하나만 적었어요: 뚱카롱. 먹은 만큼 숫자를 고친 뒤 기록을 눌러 주세요." });
    expect(photoOutcome(200, { kind: "food", sentence: "" })).toEqual({ kind: "notice", text: PHOTO_NOTICE.failed });
    expect(photoOutcome(200, { kind: "not_food" })).toEqual({ kind: "notice", text: PHOTO_NOTICE.notFood });
    expect(photoOutcome(200, { kind: "unreadable" })).toEqual({ kind: "notice", text: PHOTO_NOTICE.unreadable });
    expect(photoOutcome(429, { error: "rate_limited" })).toEqual({ kind: "notice", text: PHOTO_NOTICE.limited });
    expect(photoOutcome(429, { error: "photo_daily_limit" })).toEqual({ kind: "notice", text: PHOTO_NOTICE.dailyLimit });
    expect(photoOutcome(503, null)).toEqual({ kind: "notice", text: PHOTO_NOTICE.failed });
    expect(photoOutcome(404, { error: "not_found" })).toEqual({ kind: "notice", text: PHOTO_NOTICE.failed });
  });
});

describe("photo limits", () => {
  const config = { CHAT_PER_MINUTE: 9, CHAT_PER_DAY: 9, RESOLVE_PER_MINUTE: 9, RESOLVE_PER_DAY: 9, JEV_CALLS_PER_DAY: 9, PHOTO_PER_MINUTE: 2, PHOTO_PER_DAY: 3, PHOTO_CALLS_PER_DAY: 2, REPORT_PER_MINUTE: 2, REPORT_PER_DAY: 3, REPORTS_PER_DAY: 2 };

  it("counts photos apart from chat, per identity", async () => {
    const limits = createUsageLimits(createMemoryRateLimiter({ now: () => 0 }), config);
    expect((await limits.checkRequest("photo", "a")).allowed).toBe(true);
    expect((await limits.checkRequest("photo", "a")).allowed).toBe(true);
    expect((await limits.checkRequest("photo", "a")).allowed).toBe(false);
    expect((await limits.checkRequest("photo", "b")).allowed).toBe(true);
    expect((await limits.checkRequest("chat", "a")).allowed).toBe(true);
  });

  it("stops the whole service at the daily cap without touching the Jev cap", async () => {
    const limits = createUsageLimits(createMemoryRateLimiter({ now: () => 0 }), config);
    await limits.beforePhotoCall();
    await limits.beforePhotoCall();
    await expect(limits.beforePhotoCall()).rejects.toBeInstanceOf(UsageLimitExceeded);
    await expect(limits.beforeJevCall()).resolves.toBeUndefined();
  });

  it("is off by default, with small defaults", () => {
    const parsed = envSchema.parse({});
    expect(parsed.PHOTO_INPUT).toBe("off");
    expect(parsed.PHOTO_MODEL).toBe("claude-opus-5-5");
    expect([parsed.RATE_LIMIT_PHOTO_PER_MINUTE, parsed.RATE_LIMIT_PHOTO_PER_DAY, parsed.PHOTO_CALLS_PER_DAY]).toEqual([3, 10, 200]);
    expect(envSchema.safeParse({ PHOTO_INPUT: "yes" }).success).toBe(false);
  });
});
