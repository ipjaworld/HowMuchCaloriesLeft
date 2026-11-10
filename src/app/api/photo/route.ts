import { createPhotoRecognizer, type PhotoRecognizer } from "@/ai/photo/recognizer";
import { isJpeg, PHOTO_MAX_BYTES, photoResult } from "@/application/photoCandidates";
import { usageLimitResponse } from "@/application/usageLimits";
import { UsageLimitExceeded } from "@/domain/rateLimit";
import { env, photoInputEnabled } from "@/env";
import { requestIdentity, usageLimits } from "@/infrastructure/serverUsageLimits";

/**
 * One photo in, one sentence out.
 *
 * Nothing is recorded here and nothing is stored: the photo is read, the
 * sentence goes back to the input box, and the user decides whether to send
 * it to `/api/chat` like anything else they typed. While `PHOTO_INPUT` is off
 * this route does not exist as far as a caller can tell.
 */

let recognizer: PhotoRecognizer | null = null;
function photoRecognizer(): PhotoRecognizer {
  recognizer ??= createPhotoRecognizer({
    apiKey: env.ANTHROPIC_API_KEY!,
    model: env.PHOTO_MODEL,
    timeoutMs: env.PHOTO_TIMEOUT_MS,
  });
  return recognizer;
}

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  if (!photoInputEnabled) return Response.json({ error: "not_found" }, { status: 404 });

  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "image/jpeg")
    return Response.json({ error: "invalid_image" }, { status: 415 });
  // Refuse an oversized upload by its declared length before reading it.
  if (Number(request.headers.get("content-length") ?? 0) > PHOTO_MAX_BYTES)
    return Response.json({ error: "image_too_large" }, { status: 413 });

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return Response.json({ error: "invalid_image" }, { status: 400 });
  }
  if (bytes.length > PHOTO_MAX_BYTES) return Response.json({ error: "image_too_large" }, { status: 413 });
  if (!isJpeg(bytes)) return Response.json({ error: "invalid_image" }, { status: 400 });

  try {
    const admission = await usageLimits.checkRequest("photo", requestIdentity(request.headers));
    if (!admission.allowed) return usageLimitResponse("rate_limited", admission.retryAfter);
    await usageLimits.beforePhotoCall();
    const reading = await photoRecognizer()(Buffer.from(bytes).toString("base64"));
    return Response.json(photoResult(reading), { headers: noStore });
  } catch (error) {
    if (error instanceof UsageLimitExceeded) return usageLimitResponse("photo_daily_limit", error.retryAfter);
    // The status only: an upstream error can echo the request, and the request is a photo.
    console.error("[photo] reading failed", error instanceof Error ? error.name : "unknown", (error as { status?: unknown }).status ?? "");
    return Response.json({ error: "photo_unavailable" }, { status: 503, headers: noStore });
  }
}
