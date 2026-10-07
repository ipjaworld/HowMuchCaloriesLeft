import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

export function createRequestIdentity({ secret = randomBytes(32).toString("hex"), vercel = false }: {
  secret?: string; vercel?: boolean;
} = {}): (headers: Headers) => string {
  return (headers) => {
    // Only Vercel's deployment environment establishes trust, never a header
    // such as x-vercel-id supplied by the caller. Outside Vercel there is no
    // trusted proxy configuration: all local requests share one bucket.
    // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
    const raw = vercel ? headers.get("x-vercel-forwarded-for")?.trim() : undefined;
    const version = raw === undefined || raw.includes("%") ? 0 : isIP(raw);
    const identity = raw !== undefined && version !== 0
      ? version === 6 ? new URL(`http://[${raw}]/`).hostname : raw
      : vercel ? "unknown-client" : "local-client";
    // The raw address exists only for this call, never in a bucket or log.
    return createHmac("sha256", secret).update(identity).digest("hex");
  };
}
