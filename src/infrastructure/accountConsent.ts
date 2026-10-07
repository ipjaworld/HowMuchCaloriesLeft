import { createHmac, timingSafeEqual } from "node:crypto";
import { ACCOUNT_POLICY_VERSION } from "@/domain/account";
export function signConsent(secret: string, now = Date.now()) {
  const value = `${ACCOUNT_POLICY_VERSION}.${now}`;
  return `${value}.${createHmac("sha256", secret).update(value).digest("hex")}`;
}
export function validConsent(
  value: string | undefined,
  secret: string,
  now = Date.now(),
) {
  if (!value) return false;
  const [version, at, signature] = value.split(".");
  if (
    version !== ACCOUNT_POLICY_VERSION ||
    !at ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const age = now - Number(at);
  if (!Number.isFinite(age) || age < 0 || age > 15 * 60_000) return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    createHmac("sha256", secret).update(`${version}.${at}`).digest(),
  );
}
