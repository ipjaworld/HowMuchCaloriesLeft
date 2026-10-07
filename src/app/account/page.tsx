import { AccountScreen } from "@/components/AccountScreen";
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  const params = await searchParams;
  return <AccountScreen loginFailed={params.error === "login"} welcome={params.welcome === "1"} />;
}
