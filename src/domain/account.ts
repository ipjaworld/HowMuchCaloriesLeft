import type { ConversationTurn } from "./conversation";
import type { DailyGoal, MealRecord } from "./meal";
import type { SyncMeta } from "./syncMeta";

export const ACCOUNT_POLICY_VERSION = "2026-10-07";
export type AccountData = {
  records: MealRecord[];
  goals: DailyGoal[];
  turns: ConversationTurn[];
  meta: SyncMeta;
};
export const emptyAccountData = (): AccountData => ({
  records: [],
  goals: [],
  turns: [],
  meta: { removedRecords: [], goalSetAt: {} },
});
export type AccountSnapshot = { data: AccountData; revision: number };
export type AccountStatus = {
  configured: boolean;
  userId: string | null;
  providers: ("google" | "kakao")[];
};
