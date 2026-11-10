import type { Metadata } from "next";
import { ImportScreen } from "@/components/ImportScreen";

export const metadata: Metadata = {
  title: "기록 가져오기 · 오늘 얼마 먹어도 돼?",
  robots: { index: false },
  // The records arrive in the URL fragment; no other site should see the URL.
  referrer: "no-referrer",
};

export default function ImportPage() {
  return (
    <main className="app-shell">
      <ImportScreen />
    </main>
  );
}
