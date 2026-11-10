import { PHOTO_MAX_BYTES, type PhotoResult } from "@/application/photoCandidates";

/**
 * The browser's half of photo input: shrink the photo, send it, and turn the
 * answer into something to say.
 *
 * Every photo is redrawn onto a canvas before it leaves the device. That
 * makes it small, makes it a JPEG whatever it started as, and drops the
 * metadata a camera attaches (where and when it was taken) — the redrawn
 * pixels are all that is sent.
 */

const LONG_EDGE = 1280;

export type PhotoOutcome =
  | { kind: "filled"; sentence: string; note: string }
  | { kind: "notice"; text: string };

export const PHOTO_NOTICE = {
  read: "사진에서 읽은 내용이에요. 맞게 고친 뒤 기록을 눌러 주세요.",
  notFood: "사진에서 음식을 찾지 못했어요. 먹은 걸 글로 적어 주세요.",
  unreadable: "사진을 알아보기 어려워요. 더 밝고 가깝게 찍거나 글로 적어 주세요.",
  limited: "사진 입력이 많아요. 잠시 후 다시 하거나 글로 적어 주세요.",
  dailyLimit: "오늘 사진 입력은 마감됐어요. 글로 적어 주세요.",
  failed: "사진을 읽지 못했어요. 다시 하거나 글로 적어 주세요.",
  notImage: "이 파일은 열 수 없어요. 다른 사진을 골라 주세요.",
} as const;

/**
 * A box of macarons, a shared pot: the photo shows several and cannot show
 * how many were eaten, so one was written. Says so, and what to change.
 */
export function assumedOneNotice(names: string[]): string {
  return `사진으로는 먹은 양을 알 수 없어 하나만 적었어요: ${names.join(", ")}. 먹은 만큼 숫자를 고친 뒤 기록을 눌러 주세요.`;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers decode a format through <img> that they refuse here.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Null when the file is not a picture this browser can open. */
export async function shrinkPhoto(file: Blob): Promise<Blob | null> {
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    return null;
  }
  try {
    if (decoded.width === 0 || decoded.height === 0) return null;
    const scale = Math.min(1, LONG_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) return null;
    // JPEG has no transparency; without this a cut-out PNG turns black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob !== null && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    return null;
  } finally {
    decoded.close();
  }
}

export function photoOutcome(status: number, body: unknown): PhotoOutcome {
  if (status === 200 && typeof body === "object" && body !== null) {
    const result = body as PhotoResult;
    if (result.kind === "food" && typeof result.sentence === "string" && result.sentence !== "") {
      const several = Array.isArray(result.assumedOne)
        ? result.assumedOne.filter((name): name is string => typeof name === "string" && name !== "")
        : [];
      return { kind: "filled", sentence: result.sentence, note: several.length === 0 ? PHOTO_NOTICE.read : assumedOneNotice(several) };
    }
    if (result.kind === "not_food") return { kind: "notice", text: PHOTO_NOTICE.notFood };
    if (result.kind === "unreadable") return { kind: "notice", text: PHOTO_NOTICE.unreadable };
  }
  if (status === 429) {
    const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
    return { kind: "notice", text: error === "photo_daily_limit" ? PHOTO_NOTICE.dailyLimit : PHOTO_NOTICE.limited };
  }
  return { kind: "notice", text: PHOTO_NOTICE.failed };
}

export async function readPhoto(file: Blob): Promise<PhotoOutcome> {
  const photo = await shrinkPhoto(file);
  if (photo === null) return { kind: "notice", text: PHOTO_NOTICE.notImage };
  try {
    const response = await fetch("/api/photo", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: photo,
    });
    return photoOutcome(response.status, await response.json().catch(() => null));
  } catch {
    return { kind: "notice", text: PHOTO_NOTICE.failed };
  }
}
