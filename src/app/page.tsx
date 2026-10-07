import { AppNavigation } from "@/components/AppNavigation";
import { TodayScreen } from "@/components/TodayScreen";
import { AccountBoundary } from "@/components/AccountBoundary";
import { accountConfigured } from "@/infrastructure/accountAuth";

/**
 * Server component: it renders the shell and nothing else. All state lives in
 * `TodayScreen`, the one client boundary, because it comes from localStorage.
 *
 * On a phone the column is the whole screen. On a desktop it sits on the warm
 * canvas as a single surface — an app someone opens, not a page they landed on.
 */
export default function Home() {
  return (
    <main className="app-shell">
      {accountConfigured() ? <AccountBoundary /> : <><AppNavigation current="today" accountEnabled={false} /><TodayScreen /></>}
    </main>
  );
}
