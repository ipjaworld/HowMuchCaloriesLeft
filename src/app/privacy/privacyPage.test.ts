import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ account: false, shared: false, recovery: "off" }));
vi.mock("@/env", () => ({
  env: {
    PRIVACY_OPERATOR: "운영자",
    PRIVACY_CONTACT_EMAIL: "ops@example.test",
    get ACCOUNT_RECOVERY_ENABLED() { return state.recovery; },
  },
}));
vi.mock("@/infrastructure/accountAuth", () => ({ accountConfigured: () => state.account }));
vi.mock("@/infrastructure/serverUsageLimits", () => ({ sharedRateLimitConfigured: () => state.shared }));

const { default: PrivacyPage } = await import("./page");
const render = () => renderToStaticMarkup(PrivacyPage());

beforeEach(() => Object.assign(state, { account: false, shared: false, recovery: "off" }));

describe("privacy policy lists only what is actually sent", () => {
  it("names TypeSafe and Vercel for everyone, and nothing account-only while accounts are off", () => {
    const html = render();
    expect(html).toContain("TypeSafe AI, Inc.");
    expect(html).toContain("Vercel Inc.");
    expect(html).not.toContain("Supabase, Inc.");
    expect(html).not.toContain("Upstash, Inc.");
    expect(html).not.toContain("최근 3개(약 90일)");
    expect(html).toContain("계정 기능은 현재 준비 중입니다.");
  });
  it("adds Supabase and the backup retention once accounts are on", () => {
    state.account = true;
    const html = render();
    expect(html).toContain("Supabase, Inc.");
    expect(html).toContain("privacy@supabase.com");
    expect(html).toContain("최근 3개(약 90일)");
    expect(html).not.toContain("계정 기능은 현재 준비 중입니다.");
  });
  it("adds Upstash only while the shared rate-limit store is in use", () => {
    state.shared = true;
    expect(render()).toContain("Upstash, Inc.");
  });
  it("describes the Kakao grace period only while recovery is enabled", () => {
    expect(render()).not.toContain("7일(168시간)");
    state.recovery = "on";
    expect(render()).toContain("7일(168시간)");
  });
  it("tells every overseas recipient's country, items, timing, retention, refusal and contact", () => {
    Object.assign(state, { account: true, shared: true });
    const html = render();
    for (const label of ["이전 국가:", "이전 항목:", "이전 시기·방법:", "보유·이용 기간:", "거부 방법과 효과:", "연락처:"])
      expect(html.split(label).length - 1, label).toBe(4);
  });
});
