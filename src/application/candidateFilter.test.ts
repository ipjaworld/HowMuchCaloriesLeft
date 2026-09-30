import { describe, expect, it, vi } from "vitest";
import type { CandidateJudge } from "@/ai/judgment/candidateJudge";
import type { Judge, Judgment, RecentItem } from "@/ai/judgment/types";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { resolveAddParts, type AddPart } from "./addFood";
import { dropUneatenQuestions, filterUneatenQuestions } from "./candidateFilter";
import { runChat } from "./chatPipeline";
import { describePart } from "./foodCoverage";

const resolved = (name: string): AddPart => ({
  status: "resolved",
  phraseName: name,
  item: { name, calories: 100, calorieSource: "dataset", caloriesEstimated: false },
});
const unknown = (phrase: string): AddPart => ({ status: "unknown", phraseName: phrase });

/** Answers each phrase from a table; anything not in it is eaten. */
function tableJudge(table: Record<string, number>): CandidateJudge & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async judgeEaten(_message, phrases) {
      calls.push(phrases);
      return phrases.map((phrase) => table[phrase] ?? 0.95);
    },
  };
}

describe("dropUneatenQuestions", () => {
  it("drops a question the user did not eat, keeps one they did", () => {
    const { parts, dropped } = dropUneatenQuestions(
      [unknown("팀원들"), resolved("삼겹살구이"), unknown("딸기케이크")],
      [0.04, 0.9],
    );
    expect(parts.map((p) => p.phraseName)).toEqual(["삼겹살구이", "딸기케이크"]);
    expect(dropped).toEqual(["팀원들"]);
  });

  it("never drops a resolved food, whatever it is given", () => {
    const parts = [resolved("김밥"), resolved("라면")];
    expect(dropUneatenQuestions(parts, [0, 0]).parts).toEqual(parts);
  });

  it("treats a missing answer as keep, not as no", () => {
    const { parts } = dropUneatenQuestions([unknown("a"), unknown("b")], [0.9]);
    expect(parts).toHaveLength(2);
  });

  it("keeps a part exactly at the threshold", () => {
    expect(dropUneatenQuestions([unknown("a")], [0.3]).parts).toHaveLength(1);
  });
});

describe("filterUneatenQuestions", () => {
  const parts = [resolved("삼겹살구이"), unknown("팀원들")];

  it("sends only the unsettled phrases", async () => {
    const judge = tableJudge({ 팀원들: 0.03 });
    const result = await filterUneatenQuestions("팀원들이랑 회식에서 삼겹살 먹었어", parts, judge);
    expect(judge.calls).toEqual([["팀원들"]]);
    expect(result.parts.map((p) => p.phraseName)).toEqual(["삼겹살구이"]);
    expect(result.report).toEqual({ status: "applied", asked: 1, dropped: ["팀원들"] });
  });

  it("sends nothing when everything is settled", async () => {
    const judge = tableJudge({});
    const result = await filterUneatenQuestions("김밥", [resolved("김밥")], judge);
    expect(judge.calls).toEqual([]);
    expect(result.report).toEqual({ status: "no_questions" });
  });

  it("is off without a judge", async () => {
    expect((await filterUneatenQuestions("x", parts, null)).report).toEqual({ status: "off" });
  });

  it.each([
    ["a timeout", () => Promise.reject(Object.assign(new Error("t"), { name: "APITimeoutError" }))],
    ["a rate limit", () => Promise.reject(Object.assign(new Error("429"), { name: "RateLimitError" }))],
    ["a short answer", () => Promise.resolve([])],
  ])("keeps every part on %s", async (_label, answer) => {
    const judge: CandidateJudge = { judgeEaten: vi.fn(answer) };
    const result = await filterUneatenQuestions("x", parts, judge);
    expect(result.parts).toEqual(parts);
    expect(result.report.status).toBe("failed");
  });
});

describe("runChat with the filter", () => {
  const judgment = (intent: Judgment["intent"], extra: Partial<Judgment> = {}): Judgment => ({
    intent,
    intentConfidence: 0.99,
    actualConsumptionProbability: 0.98,
    clarificationProbability: 0.1,
    referenceTargetId: null,
    referenceConfidence: null,
    source: "jev",
    ...extra,
  });
  const fixedJudge = (value: Judgment): Judge => ({ judge: () => Promise.resolve(value) });
  const input = (message: string, recentItems: RecentItem[] = []) => ({
    message,
    now: "2026-10-01T12:30:00+09:00",
    dailyGoalCalories: 1800,
    recentItems,
  });

  it("drops the question about 팀원들 and keeps 삼겹살", async () => {
    const result = await runChat(input("팀원들이랑 회식에서 삼겹살 먹었어"), undefined, {
      judge: fixedJudge(judgment("add_food")),
      resolver: koreanFoodResolver,
      candidateJudge: tableJudge({ 팀원들: 0.02 }),
    });
    expect(result.command.type).toBe("add");
    if (result.command.type !== "add") return;
    expect(result.command.parts.map(describePart)).toEqual(['resolved 삼겹살구이 (1인분) ← "회식에서 삼겹살"']);
    expect(result.candidateFilter).toMatchObject({ status: "applied", dropped: ["팀원들"] });
  });

  it("asks as before when the filter fails", async () => {
    const before = await resolveAddParts("팀원들이랑 회식에서 삼겹살 먹었어", koreanFoodResolver);
    const result = await runChat(input("팀원들이랑 회식에서 삼겹살 먹었어"), undefined, {
      judge: fixedJudge(judgment("add_food")),
      resolver: koreanFoodResolver,
      candidateJudge: { judgeEaten: () => Promise.reject(new Error("down")) },
    });
    if (result.command.type !== "add") throw new Error("expected add");
    expect(result.command.parts).toEqual(before);
    expect(result.candidateFilter?.status).toBe("failed");
  });

  it("leaves the command exactly as the filter-off path when it drops nothing", async () => {
    // The report is for QA; the app acts on the command alone.
    const deps = { judge: fixedJudge(judgment("add_food")), resolver: koreanFoodResolver };
    const message = "딸기케이크랑 김밥 먹었어";
    const off = await runChat(input(message), undefined, { ...deps, candidateJudge: null });
    const on = await runChat(input(message), undefined, { ...deps, candidateJudge: tableJudge({}) });
    expect(on.command).toEqual(off.command);
    expect(off.candidateFilter).toEqual({ status: "off" });
    expect(on.candidateFilter?.status).toBe("applied");
  });

  it("does not wait for the filter to decide a non-add", async () => {
    const result = await runChat(input("갈비탕 칼로리 높아?"), undefined, {
      judge: fixedJudge(judgment("other")),
      resolver: koreanFoodResolver,
      candidateJudge: { judgeEaten: () => new Promise(() => {}) },
    });
    expect(result.command).toEqual({ type: "ignore", reason: "off_topic" });
  });

  it("carries the extra food of a mixed correction, and asks before applying it", async () => {
    const [logged] = await resolveAddParts("떡볶이 먹었어", koreanFoodResolver);
    if (logged?.status !== "resolved") throw new Error("setup");
    const target: RecentItem = {
      id: "rec-1",
      name: logged.item.name,
      ...(logged.item.amount === undefined ? {} : { amount: logged.item.amount }),
      calories: logged.item.calories,
      consumedAt: "2026-10-01T11:40:00+09:00",
    };
    const result = await runChat(input("떡볶이랑 튀김 먹었는데 떡볶이는 반만", [target]), undefined, {
      judge: fixedJudge(judgment("modify_food", { referenceTargetId: "rec-1", referenceConfidence: 0.95 })),
      resolver: koreanFoodResolver,
      candidateJudge: null,
    });
    expect(result.command).toMatchObject({ type: "modify_candidate", targetId: "rec-1", needsConfirmation: true });
    if (result.command.type !== "modify_candidate") return;
    expect(result.command.extraParts?.map(describePart)).toEqual(['unknown ← "튀김"']);
  });
});
