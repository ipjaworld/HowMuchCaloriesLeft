import type { Metadata } from "next";
import { AppNavigation } from "@/components/AppNavigation";
import { AccountBoundary } from "@/components/AccountBoundary";
import { ChallengeScreen } from "@/components/ChallengeScreen";
import { accountConfigured } from "@/infrastructure/accountAuth";

export const metadata: Metadata = { title: "월간 기록 챌린지 · 오늘 얼마 먹어도 돼?" };
export default function ChallengePage() {
  return <main className="app-shell">
    {accountConfigured() ? <AccountBoundary challenge /> : <><AppNavigation current="challenge" accountEnabled={false} /><ChallengeScreen /></>}
  </main>;
}
