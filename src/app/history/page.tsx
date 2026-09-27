import type { Metadata } from "next";
import { HistoryScreen } from "@/components/HistoryScreen";

export const metadata: Metadata = {
  title: "지난 기록 · 오늘 얼마 먹어도 돼?",
};

/** The same single column as Today, so moving between them feels like one app. */
export default function HistoryPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col bg-surface sm:border-x sm:border-line sm:shadow-[0_0_40px_-24px_rgba(27,25,23,0.35)]">
      <HistoryScreen />
    </main>
  );
}
