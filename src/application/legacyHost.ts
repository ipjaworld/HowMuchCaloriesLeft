/**
 * Which requests belong to an address the app has moved away from.
 *
 * Deliberately free of imports: `proxy.ts` runs in front of the app and should
 * not pull the app's modules in with it.
 */

/** The one page an old address still serves. */
export const MOVED_PATH = "/moved";

type MoveEnv = Record<string, string | undefined> & { LEGACY_HOSTS?: string; APP_ORIGIN?: string };

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when `host` is listed as an old address and there is a different
 * current address to send people to. An unset or malformed setting means the
 * app behaves exactly as it did before the move.
 */
export function isLegacyHost(host: string | null, env: MoveEnv): boolean {
  if (!host) return false;
  const current = hostOf(env.APP_ORIGIN);
  if (current === null) return false;
  const asked = host.trim().toLowerCase();
  if (asked === current) return false;
  return (env.LEGACY_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .includes(asked);
}
