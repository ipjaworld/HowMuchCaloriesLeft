import { AccountScreen } from "@/components/AccountScreen";
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return <AccountScreen loginFailed={params.error === "login"} />;
}
