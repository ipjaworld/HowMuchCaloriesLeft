import type { AccountSnapshot, AccountData } from "@/domain/account";
import type { ConversationRepository } from "@/domain/conversation";
import { dateKeyOf } from "@/domain/date";
import { effectiveGoal } from "@/domain/history";
import type {
  MealRecordRepository,
  DailyGoalRepository,
} from "@/domain/repository";
import type { AccountMutation } from "@/application/accountMutation";
type WithoutRevision<T> = T extends unknown ? Omit<T, "revision"> : never;
export class AccountStorageError extends Error {
  constructor(readonly status: number) {
    super(
      status === 409
        ? "다른 기기에서 기록이나 계정이 바뀌었어요. 일부 변경은 이미 저장됐을 수 있으니 새로고침한 뒤 확인해 주세요."
        : "계정 기록의 저장 결과를 확인하지 못했어요. 일부 변경은 이미 저장됐을 수 있으니 연결을 확인하고 새로고침해 주세요.",
    );
  }
}
/** Memory cache belongs to one screen. Account data never enters localStorage. */
export function createRemoteRepositories(userId: string) {
  let cached: AccountSnapshot | null = null;
  let reading: Promise<AccountSnapshot> | null = null;
  async function read(): Promise<AccountSnapshot> {
    if (cached) return cached;
    if (reading) return reading;
    reading = (async () => {
      const r = await fetch("/api/account/data", {
        cache: "no-store",
        headers: { "x-account-id": userId },
      });
      if (!r.ok) throw new AccountStorageError(r.status);
      cached = (await r.json()) as AccountSnapshot;
      return cached;
    })();
    try {
      return await reading;
    } finally {
      reading = null;
    }
  }
  async function mutate(mutation: WithoutRevision<AccountMutation>) {
    const before = await read();
    let response: Response;
    try {
      response = await fetch("/api/account/data", {
        method: "POST",
        headers: { "content-type": "application/json", "x-account-id": userId },
        body: JSON.stringify({ ...mutation, revision: before.revision }),
      });
    } catch {
      throw new AccountStorageError(503);
    }
    if (!response.ok) throw new AccountStorageError(response.status);
    cached = (await response.json()) as AccountSnapshot;
  }
  const meals: MealRecordRepository = {
    getAll: async () => structuredClone((await read()).data.records),
    getByDate: async (date) =>
      structuredClone(
        (await read()).data.records.filter(
          (r) => dateKeyOf(r.consumedAt) === date,
        ),
      ),
    add: async (record) => mutate({ operation: "add", record }),
    update: async (id, input) => mutate({ operation: "update", id, input }),
    remove: async (id) => mutate({ operation: "remove", id }),
  };
  const goals: DailyGoalRepository = {
    getAll: async () => structuredClone((await read()).data.goals),
    get: async (date) => effectiveGoal((await read()).data.goals, date),
    getExact: async (date) =>
      (await read()).data.goals.find((g) => g.date === date) ?? null,
    set: async (goal) => mutate({ operation: "goal", goal }),
  };
  const conversation: ConversationRepository = {
    getAll: async () => ({
      turns: structuredClone((await read()).data.turns),
      saved: true,
      dropped: 0,
    }),
    append: async (turn) => {
      await mutate({ operation: "turn", turn });
      return conversation.getAll();
    },
  };
  return {
    meals,
    goals,
    conversation,
    import: async (data: AccountData) =>
      mutate({ operation: "import", data, consent: true }),
    snapshot: async () => structuredClone(await read()),
  };
}
