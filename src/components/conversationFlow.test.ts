import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode, type ComponentProps } from "react";
import { TodayScreen } from "./TodayScreen";
import { ChatInput } from "./ChatInput";
import { MealList } from "./MealList";
import { replyText, UNDO_DELETE } from "./replyText";
import type { Command } from "@/application/commands";
import type { AddPart } from "@/application/addFood";
import type { ConversationTurn } from "@/domain/conversation";
import type { MealRecord } from "@/domain/meal";
import { createMemoryStorage, STORAGE_KEYS } from "@/infrastructure/storage";

// Event-handler integration without adding a DOM dependency. The real screen,
// application functions and repositories run; only hook scheduling is manual.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState(initial: unknown) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[i], (next: unknown) => { hooks.slots[i] = typeof next === "function" ? next(hooks.slots[i]) : next; }];
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial };
    return hooks.slots[i];
  },
  useMemo(make: () => unknown) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = make();
    return hooks.slots[i];
  },
  useEffect(effect: () => unknown) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) { hooks.slots[i] = true; hooks.effects.push(effect); }
  },
}));

function findProps<P>(node: ReactNode, component: unknown): P | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findProps<P>(child, component); if (found) return found; }
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === component) return node.props as P;
  return findProps<P>(node.props.children, component);
}

function render() { hooks.cursor = 0; return TodayScreen(); }
function chat() { return findProps<ComponentProps<typeof ChatInput>>(render(), ChatInput)!; }
function mealList() { return findProps<ComponentProps<typeof MealList>>(render(), MealList)!; }
const food = { name: "커피", amount: "1잔", calories: 9, caloriesEstimated: false };
const resolved: AddPart = { status: "resolved", phraseName: "커피", item: food };
const add = (parts: AddPart[] = [resolved], needsConfirmation = false): Command => ({ type: "add", sourceText: "커피 먹었어", parts, needsConfirmation });
let storage: ReturnType<typeof createMemoryStorage>;
let fetchMock: ReturnType<typeof vi.fn>;
const turns = (): ConversationTurn[] => JSON.parse(storage.getItem(STORAGE_KEYS.conversation) ?? '{"turns":[]}').turns;
const records = (): MealRecord[] => JSON.parse(storage.getItem(STORAGE_KEYS.mealRecords) ?? '{"records":[]}').records;
async function settle() { await vi.waitFor(() => expect(chat().isPending).toBe(false)); }
async function send(command: Command, message = "입력") {
  fetchMock.mockResolvedValueOnce(Response.json({ command }));
  chat().onSubmit(message);
  await settle();
}
async function choose(id: string, label: string) {
  chat().onChooseOption({ id, label });
  await settle();
}

beforeEach(async () => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  storage = createMemoryStorage({ [STORAGE_KEYS.onboarding]: '{"version":1,"promptSeenAt":"seen"}' });
  vi.stubGlobal("window", { localStorage: storage });
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render();
  for (const effect of hooks.effects.splice(0)) effect();
  await settle();
});
afterEach(() => vi.unstubAllGlobals());

describe("one persisted turn per Today action", () => {
  it("records an add with meal ids and exactly the displayed reply", async () => {
    await send(add(), "커피 먹었어");
    expect(turns()).toHaveLength(1);
    expect(turns()[0]).toMatchObject({ user: "커피 먹었어", outcome: "added", recordIds: [records()[0]!.id], reply: replyText(chat().reply!) });
    expect(turns()[0]?.reply).toContain("커피 1잔 9 kcal");
  });

  it("records questions and confirmation choices as separate turns", async () => {
    await send(add([resolved], true), "커피 먹은 듯");
    expect(turns()[0]).toMatchObject({ outcome: "asked", recordIds: [] });
    await choose("yes", "네");
    expect(turns()).toHaveLength(2);
    expect(turns()[1]).toMatchObject({ user: "네", outcome: "added", recordIds: [records()[0]!.id] });
  });

  it.each(["typed", "chip"])("records %s cancellation without meal ids", async (mode) => {
    await send(add([resolved], true));
    if (mode === "typed") { chat().onSubmit("취소"); await settle(); }
    else await choose("no", "아니요");
    expect(turns()[1]).toMatchObject({ outcome: "cancelled", recordIds: [] });
    expect(records()).toEqual([]);
  });

  it("records an unknown food with nothing_added when there is no confirmation", async () => {
    await send(add([{ status: "unknown", phraseName: "낯선음식" }], true));
    expect(turns()[0]).toMatchObject({ outcome: "nothing_added", recordIds: [] });
  });

  it("records quantity questions even when the reply has no choice chips", async () => {
    await send(add([{ status: "unmeasurable", phraseName: "커피", entries: [{ id: "coffee", name: "커피" }], reason: "missing_serving" }]));
    expect(chat().reply?.kind).toBe("statement");
    expect(turns()[0]).toMatchObject({ outcome: "asked", recordIds: [] });
  });

  it("records an answer without changing meals", async () => {
    await send({ type: "answer", kind: "status" });
    expect(turns()[0]).toMatchObject({ outcome: "answered", recordIds: [] });
  });

  it("records × and undo with null user, the same meal id and a cleared marker", async () => {
    await send(add());
    const record = records()[0]!;
    mealList().onDeleteItem!(record.items[0]!);
    await settle();
    expect(turns()[1]).toMatchObject({ user: null, outcome: "removed", recordIds: [record.id] });
    expect(records()).toEqual([]);
    await choose(UNDO_DELETE, "되돌리기");
    expect(turns()[2]).toMatchObject({ user: null, outcome: "restored", recordIds: [record.id] });
    expect(records()[0]?.id).toBe(record.id);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.syncMeta)!).removedRecords).toEqual([]);
  });

  it("records a spoken deletion with its own user text", async () => {
    await send(add());
    const record = records()[0]!;
    await send({ type: "delete_candidate", targetId: record.items[0]!.id }, "커피 지워줘");
    expect(turns()[1]).toMatchObject({ user: "커피 지워줘", outcome: "removed", recordIds: [record.id] });
  });

  it("records a modification against the containing meal id", async () => {
    await send(add());
    const record = records()[0]!;
    await send({ type: "modify_candidate", targetId: record.items[0]!.id, sourceText: "커피 18kcal로 고쳐줘", needsConfirmation: false, parts: [{ ...resolved, item: { ...food, calories: 18 } }] });
    expect(turns()[1]).toMatchObject({ outcome: "modified", recordIds: [record.id] });
    expect(records()[0]?.items[0]?.calories).toBe(18);
  });

  it("records a failed request and preserves no invented meal ids", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    chat().onSubmit("커피"); await settle();
    expect(turns()[0]).toMatchObject({ outcome: "failed", recordIds: [] });
  });

  it("keeps a target chip label on a resent modification and records it only once", async () => {
    await send(add());
    const record = records()[0]!;
    const item = record.items[0]!;
    await send({ type: "clarify", reason: "unknown_target", intent: "modify_food", candidates: [{ id: item.id, name: item.name }] }, "커피 18kcal로 고쳐줘");
    fetchMock.mockResolvedValueOnce(Response.json({ command: { type: "modify_candidate", targetId: item.id, sourceText: "커피 18kcal로 고쳐줘", needsConfirmation: false, parts: [{ ...resolved, item: { ...food, calories: 18 } }] } }));
    await choose(item.id, "커피 1잔");
    expect(turns()).toHaveLength(3);
    expect(turns()[2]).toMatchObject({ user: "커피 1잔", outcome: "modified", recordIds: [record.id] });
  });

  it("records both ids when a correction also adds another meal", async () => {
    await send(add());
    const record = records()[0]!;
    await send({ type: "modify_candidate", targetId: record.items[0]!.id, sourceText: "커피는 18kcal이고 사과도 먹었어", needsConfirmation: false, parts: [{ ...resolved, item: { ...food, calories: 18 } }], extraParts: [{ status: "resolved", phraseName: "사과", item: { name: "사과", calories: 100, caloriesEstimated: false } }] });
    expect(turns()[1]).toMatchObject({ outcome: "modified", recordIds: records().map((entry) => entry.id) });
    expect(records()).toHaveLength(2);
  });

  it("a failed meal write becomes a failed turn, not a success reply", async () => {
    const original = storage.setItem;
    storage.setItem = (key, value) => { if (key === STORAGE_KEYS.mealRecords) throw new Error("full"); original(key, value); };
    await send(add());
    expect(turns()[0]).toMatchObject({ outcome: "failed", recordIds: [] });
    expect(chat().reply?.text).toContain("저장하지 못했어요");
    expect(records()).toEqual([]);
  });

  it("conversation failure leaves meal success visible and shows a separate notice", async () => {
    const original = storage.setItem;
    storage.setItem = (key, value) => { if (key === STORAGE_KEYS.conversation) throw new Error("full"); original(key, value); };
    await send(add());
    expect(records()).toHaveLength(1);
    expect(chat().reply?.text).toContain("기록했어요");
    expect(JSON.stringify(render())).toContain("대화 기록을 보관하지 못했어요");
  });

  it("guards rapid double taps before React renders busy state", async () => {
    await send(add([resolved], true));
    const handler = chat().onChooseOption;
    handler({ id: "yes", label: "네" }); handler({ id: "yes", label: "네" });
    await settle();
    expect(records()).toHaveLength(1);
    expect(turns()).toHaveLength(2);
  });
});
