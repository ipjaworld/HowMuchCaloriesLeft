import { z } from "zod";
import type { AccountData } from "@/domain/account";
import { accountDataSchema } from "@/infrastructure/accountSchemas";

/**
 * Carrying one browser's records from the old address to the new one.
 *
 * The records travel in the URL fragment — the part after `#`, which a
 * browser never sends to a server — so nothing here adds a server-side copy.
 * What arrives is treated as untrusted: anyone can write a link, so it is
 * size-bounded, schema-checked, and only ever merged after the user confirms.
 */

export type MovePayload = {
  v: 1;
  /**
   * Meals, goals, conversation and their sync notes — what an account merge
   * carries. Calculator body facts are deliberately not included: they stay in
   * the browser they were typed into (see privacy.test.ts).
   */
  data: AccountData;
};

const movePayloadSchema = z
  .object({
    v: z.literal(1),
    data: accountDataSchema,
  })
  .strict();

export const MOVE_FRAGMENT_KEY = "d";
/** Well inside what current browsers carry in a URL. */
export const MAX_ENCODED_LENGTH = 1_500_000;
/** A small fragment must not be able to expand into something huge. */
const MAX_DECODED_BYTES = 20_000_000;

export function movePayloadIsEmpty(payload: MovePayload): boolean {
  const { records, goals, turns } = payload.data;
  return records.length + goals.length + turns.length === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECODED_BYTES) {
      await reader.cancel();
      throw new Error("Move payload too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** `g.` gzip, `j.` plain — for browsers without CompressionStream. */
export async function encodeMovePayload(payload: MovePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "undefined") return `j.${toBase64Url(bytes)}`;
  const zipped = await readBounded(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  );
  return `g.${toBase64Url(zipped)}`;
}

/** Null for anything that is not a payload this app wrote. Never throws. */
export async function decodeMovePayload(encoded: string): Promise<MovePayload | null> {
  if (encoded.length > MAX_ENCODED_LENGTH) return null;
  try {
    const kind = encoded.slice(0, 2);
    const body = fromBase64Url(encoded.slice(2));
    let bytes: Uint8Array;
    if (kind === "j.") bytes = body;
    else if (kind === "g.") {
      bytes = await readBounded(
        new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip")),
      );
    } else return null;
    const parsed = movePayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? (parsed.data as MovePayload) : null;
  } catch {
    return null;
  }
}

export type MoveLink = { href: string; withoutConversation: boolean };

/**
 * The link to the new address carrying `payload`. When everything does not
 * fit, the 30-day conversation log is left behind before any meal or goal
 * is; null when even that is too much.
 */
export async function buildMoveLink(
  targetOrigin: string,
  payload: MovePayload,
): Promise<MoveLink | null> {
  const base = `${new URL("/import", targetOrigin).href}#${MOVE_FRAGMENT_KEY}=`;
  const full = await encodeMovePayload(payload);
  if (full.length <= MAX_ENCODED_LENGTH) return { href: base + full, withoutConversation: false };
  const trimmed = await encodeMovePayload({ ...payload, data: { ...payload.data, turns: [] } });
  if (trimmed.length <= MAX_ENCODED_LENGTH) return { href: base + trimmed, withoutConversation: true };
  return null;
}

/** The encoded payload in a `location.hash`, or null when there is none. */
export function moveFragment(hash: string): string | null {
  const prefix = `#${MOVE_FRAGMENT_KEY}=`;
  return hash.startsWith(prefix) && hash.length > prefix.length ? hash.slice(prefix.length) : null;
}
