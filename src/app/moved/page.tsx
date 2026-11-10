import type { Metadata } from "next";
import { MovedScreen } from "@/components/MovedScreen";
import { env } from "@/env";

export const metadata: Metadata = {
  title: "주소가 바뀌었어요 · 오늘 얼마 먹어도 돼?",
  robots: { index: false },
};

/** Read per request, so the address follows the setting without a rebuild. */
export const dynamic = "force-dynamic";

/** What an old address serves for every page — see `proxy.ts`. */
export default function MovedPage() {
  return (
    <main className="app-shell">
      <MovedScreen target={env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : null} />
    </main>
  );
}
