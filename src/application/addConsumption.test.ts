import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "@/infrastructure/storage";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import type { Judgment, JudgmentInput } from "@/ai/judgment/types";
import { describeAdded } from "@/components/replyText";
import { summarizeDay } from "@/domain/calories";
import { addConsumption } from "./addConsumption";
import { addMealRecord } from "./mealRecords";
import { runChat } from "./chatPipeline";

const at = "2026-10-07T20:46:00+09:00";
const old = { name: "제육볶음", amount: "200g", calories: 390, caloriesEstimated: false };
const extra = { ...old, amount: "50g", calories: 98 };
async function setup() {
  const repository = createLocalStorageMealRecordRepository({ storage: createMemoryStorage() });
  await addMealRecord(repository, { sourceText: "제육볶음 200g 먹었어", items: [old], consumedAt: at });
  return repository;
}
const mistaken: Judgment = { intent: "modify_food", intentConfidence: 0.97, actualConsumptionProbability: 0.99,
  clarificationProbability: 0.1, referenceTargetId: "old", referenceConfidence: 0.99, source: "jev" };
const input: JudgmentInput = { message: "제육볶음 50g 먹었어", now: at, dailyGoalCalories: 2000,
  recentItems: [{ ...old, id: "old", consumedAt: at }] };

describe("additional consumption, not replacement", () => {
  it("overrides an AI correction guess for a plain report and resolves the extra 50g", async () => {
    const result = await runChat(input, undefined, { judge: { judge: async () => mistaken }, resolver: koreanFoodResolver, candidateJudge: null });
    expect(result.command.type).toBe("add");
    if (result.command.type !== "add") throw new Error("expected add");
    expect(result.command.parts[0]).toMatchObject({ status: "resolved", item: { amount: "50g" } });
  });
  it("keeps explicit replacement as modification and resolves 50g", async () => {
    const result = await runChat({ ...input, message: "제육볶음 50g으로 수정해줘" }, undefined,
      { judge: { judge: async () => mistaken }, resolver: koreanFoodResolver, candidateJudge: null });
    expect(result.command.type).toBe("modify_candidate");
    if (result.command.type !== "modify_candidate") throw new Error("expected modification");
    expect(result.command.parts[0]).toMatchObject({ status: "resolved", item: { amount: "50g" } });
  });
  it("also understands an explicit extra serving", async () => {
    const result = await runChat({ ...input, message: "제육볶음 50g 더 먹었어" }, undefined,
      { judge: { judge: async () => mistaken }, resolver: koreanFoodResolver, candidateJudge: null });
    expect(result.command.type).toBe("add");
    if (result.command.type !== "add") throw new Error("expected add");
    expect(result.command.parts[0]).toMatchObject({ status: "resolved", item: { amount: "50g" } });
  });
  it("stores 250g / 488kcal, keeps item identity, and explains how to replace instead", async () => {
    const repository = await setup();
    const before = await repository.getAll();
    const result = await addConsumption(repository, { sourceText: input.message, items: [extra], consumedAt: at });
    const records = await repository.getAll();
    expect(records).toHaveLength(1);
    expect(records[0]?.items[0]).toMatchObject({ id: before[0]?.items[0]?.id, amount: "250g", calories: 488 });
    expect(records[0]?.sourceText).toContain("추가: 제육볶음 50g 먹었어");
    const reply = describeAdded(summarizeDay(records, 2000), [], [], [extra], result);
    expect(reply.text).toContain("총 250g");
    expect(reply.text).toContain('"제육볶음 50g으로 수정해줘"');
    expect(reply.text).toContain("1,512 kcal 남았어요");
  });
  it("does not merge across days or incompatible units", async () => {
    const repository = await setup();
    await addConsumption(repository, { sourceText: "new day", items: [extra], consumedAt: "2026-10-08T00:01:00+09:00" });
    await addConsumption(repository, { sourceText: "another portion", items: [{ ...extra, amount: "1인분" }], consumedAt: at });
    expect(await repository.getAll()).toHaveLength(3);
    expect((await repository.getAll())[0]?.items[0]?.amount).toBe("200g");
  });
  it("does not pick between multiple matching entries", async () => {
    const repository = await setup();
    await addMealRecord(repository, { sourceText: "separate", items: [old], consumedAt: at });
    expect(await addConsumption(repository, { sourceText: input.message, items: [extra], consumedAt: at })).toBeNull();
    expect(await repository.getAll()).toHaveLength(3);
  });
  it("converts compatible metric units and sums recorded calories", async () => {
    const repository = await setup();
    await addConsumption(repository, { sourceText: "additional", items: [{ ...extra, amount: "0.05kg" }], consumedAt: at });
    expect((await repository.getAll())[0]?.items[0]).toMatchObject({ amount: "250g", calories: 488 });
  });
  it("propagates write failures instead of reporting a successful addition", async () => {
    const repository = await setup();
    await expect(addConsumption({ ...repository, update: async () => { throw new Error("offline"); } },
      { sourceText: input.message, items: [extra], consumedAt: at })).rejects.toThrow("offline");
    expect((await repository.getAll())[0]?.items[0]?.amount).toBe("200g");
  });
});
