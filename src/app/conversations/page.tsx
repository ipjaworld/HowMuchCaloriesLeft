import type { Metadata } from "next";
import { AccountBoundary } from "@/components/AccountBoundary";
import { ConversationScreen } from "@/components/ConversationScreen";
import { accountConfigured } from "@/infrastructure/accountAuth";

export const metadata: Metadata = { title: "대화 기록 · 오늘 얼마 먹어도 돼?" };
export default function ConversationsPage() {
  return <main className="app-shell conversation-shell">
    {accountConfigured() ? <AccountBoundary conversations /> : <ConversationScreen />}
  </main>;
}
