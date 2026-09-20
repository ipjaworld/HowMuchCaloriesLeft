import { TodayScreen } from "@/components/TodayScreen";

/**
 * Server component: it renders the shell and nothing else. All state lives in
 * `TodayScreen`, the one client boundary, because it comes from localStorage.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col bg-white sm:border-x sm:border-neutral-100">
      <TodayScreen />
    </main>
  );
}
