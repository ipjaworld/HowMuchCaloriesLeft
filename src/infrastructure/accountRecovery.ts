import { z } from "zod";
import { env } from "@/env";
import type { AccountRecovery } from "@/domain/account";
import type { accountAuth } from "./accountAuth";

const recoverySchema = z.union([
  z.object({ state: z.enum(["active", "pending"]) }).strict(),
  z.object({ state: z.enum(["recoverable", "expired"]),
    disconnectedAt: z.iso.datetime({ offset: true }),
    deleteAfter: z.iso.datetime({ offset: true }),
  }).strict(),
]);
export class AccountSessionExpiredError extends Error {}
export async function readAccountRecovery(
  client: Pick<ReturnType<typeof accountAuth>["client"], "rpc">,
): Promise<AccountRecovery> {
  if (env.ACCOUNT_RECOVERY_ENABLED !== "on") return { state: "active" };
  const { data, error } = await client.rpc("my_account_recovery");
  if (error?.code === "42501") throw new AccountSessionExpiredError("Session is no longer active");
  if (error) throw new Error("Account recovery status unavailable");
  return recoverySchema.parse(data);
}
