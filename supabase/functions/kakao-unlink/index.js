/* global Deno */
import { handleKakaoUnlink } from "./handler.ts";

Deno.serve((request) => handleKakaoUnlink(request, {
  adminKey: Deno.env.get("KAKAO_UNLINK_ADMIN_KEY"),
  appId: "1599886",
  reportError: () => console.error("KAKAO_UNLINK_DELIVERY_FAILED: inspect DB availability and unlink queue"),
  receive: async (providerId) => {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const key = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key) throw new Error("missing server key");
    const result = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/receive_kakao_unlink`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ provider_user_id: providerId }),
      signal: AbortSignal.timeout(2000),
    });
    if (!result.ok) throw new Error("unlink delivery failed");
    await result.body?.cancel();
  },
}));
