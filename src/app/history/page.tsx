import { AppNavigation } from "@/components/AppNavigation";
import type { Metadata } from "next";
import { HistoryScreen } from "@/components/HistoryScreen";
import { AccountBoundary } from "@/components/AccountBoundary";
import { accountConfigured } from "@/infrastructure/accountAuth";

export const metadata: Metadata = {
  title: "지난 기록 · 오늘 얼마 먹어도 돼?",
};

/** The same single column as Today, so moving between them feels like one app. */
export default function HistoryPage() {
  return (
    <main className="app-shell">
      {accountConfigured() ? <AccountBoundary history /> : <><AppNavigation current="history" accountEnabled={false} /><HistoryScreen /></>}
    </main>
  );
}
