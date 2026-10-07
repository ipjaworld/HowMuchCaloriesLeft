type Dependencies = {
  adminKey: string | undefined;
  appId: string;
  receive: (providerId: string) => Promise<void>;
  reportError: () => void;
};

async function equalSecret(left: string, right: string): Promise<boolean> {
  const encode = new TextEncoder();
  const hashes = await Promise.all([left, right].map((value) =>
    crypto.subtle.digest("SHA-256", encode.encode(value))));
  const a = new Uint8Array(hashes[0]!);
  const b = new Uint8Array(hashes[1]!);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

export async function handleKakaoUnlink(request: Request, deps: Dependencies): Promise<Response> {
  const response = (status: number) => new Response(null, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (request.method !== "POST") return response(405);
  if (!deps.adminKey) { deps.reportError(); return response(503); }
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 512 || !await equalSecret(authorization, `KakaoAK ${deps.adminKey}`)) {
    return response(401);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/x-www-form-urlencoded") {
    return response(415);
  }
  // Bound streamed bodies too; Content-Length can be absent or dishonest.
  const reader = request.body?.getReader();
  if (!reader) return response(400);
  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return response(413); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch { return response(400); }
  const form = new URLSearchParams(body);
  if (["app_id", "user_id", "referrer_type"].some((key) => form.getAll(key).length !== 1)
      || form.get("app_id") !== deps.appId
      || !/^[0-9]{1,32}$/.test(form.get("user_id") ?? "")
      || !["ACCOUNT_DELETE", "FORCED_ACCOUNT_DELETE", "UNLINK_FROM_ADMIN",
        "UNLINK_FROM_APPS", "INCOMPLETE_SIGN_UP"].includes(form.get("referrer_type") ?? "")) {
    return response(400);
  }
  try { await deps.receive(form.get("user_id")!); }
  catch {
    // Kakao's unlink contract requires 200 even on internal errors and does
    // not retry this webhook. Surface a PII-free operational error explicitly.
    deps.reportError();
  }
  return response(200);
}
