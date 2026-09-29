import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLocalLlmClient } from "./client";

/**
 * The Ollama wire mapping, against a stubbed fetch. `pnpm test` never reaches
 * a real model; `pnpm eval:local-router` does.
 */

const schema = z.object({ intent: z.string(), confidence: z.number() });

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { role: "assistant", content } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return createLocalLlmClient({
    baseUrl: "http://localhost:11434/",
    model: "test-model",
    timeoutMs,
    fetch: fetchImpl,
  });
}

const ask = { system: "sys", user: "아침에 계란 두 개 먹었어", schema };

describe("createLocalLlmClient", () => {
  it("returns the validated answer and sends a structured-output request", async () => {
    let sent: { url: string; body: Record<string, unknown> } | undefined;
    const client = clientWith(async (url, init) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return reply('{"intent":"add_food","confidence":0.93}');
    });

    const result = await client.chatJson(ask);

    expect(result).toMatchObject({ ok: true, data: { intent: "add_food", confidence: 0.93 } });
    expect(sent?.url).toBe("http://localhost:11434/api/chat");
    expect(sent?.body).toMatchObject({ model: "test-model", stream: false });
    expect(sent?.body["format"]).toMatchObject({ type: "object" });
  });

  it("reports text that is not JSON as a parse failure", async () => {
    const client = clientWith(async () => reply("intent: add_food"));
    expect(await client.chatJson(ask)).toMatchObject({ ok: false, reason: "parse" });
  });

  it("reports JSON of the wrong shape as a schema failure", async () => {
    const client = clientWith(async () => reply('{"intent":"add_food"}'));
    expect(await client.chatJson(ask)).toMatchObject({ ok: false, reason: "schema" });
  });

  it("reports an Ollama error status as an http failure", async () => {
    const client = clientWith(
      async () => new Response('{"error":"model not found"}', { status: 404 }),
    );
    const result = await client.chatJson(ask);
    expect(result).toMatchObject({ ok: false, reason: "http" });
    expect(result.ok ? "" : result.detail).toContain("404");
  });

  it("reports a refused connection as a connection failure", async () => {
    const client = clientWith(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await client.chatJson(ask)).toMatchObject({ ok: false, reason: "connection" });
  });

  it("gives up at the timeout and says so", async () => {
    const client = clientWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
      20,
    );
    const result = await client.chatJson(ask);
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(15);
  });
});
