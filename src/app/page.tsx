import { TodayScreen } from "@/components/TodayScreen";

/**
 * Server component: it renders the shell and nothing else. All state lives in
 * `TodayScreen`, the one client boundary, because it comes from localStorage.
 *
 * On a phone the column is the whole screen. On a desktop it sits on the warm
 * canvas as a single surface — an app someone opens, not a page they landed on.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col bg-surface sm:border-x sm:border-line sm:shadow-[0_0_40px_-24px_rgba(27,25,23,0.35)]">
      <TodayScreen />
    </main>
  );
}
