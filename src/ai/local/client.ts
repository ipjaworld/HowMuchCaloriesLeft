import { z } from "zod";

/**
 * The Ollama boundary. Nothing above this file knows the wire format.
 *
 * It never throws. Every way a local call can go wrong comes back as a typed
 * reason, because a local model failing is an expected, measured outcome —
 * the caller falls back and records why — never a reason for the user's
 * request to fail.
 */

export type LocalLlmFailure =
  /** Nothing listening, DNS, refused — Ollama is not running. */
  | "connection"
  | "timeout"
  /** Ollama answered with an error, e.g. 404 for a model not pulled. */
  | "http"
  /** The model's text was not JSON. */
  | "parse"
  /** JSON, but not the shape asked for. */
  | "schema";

export type LocalLlmResult<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; reason: LocalLlmFailure; detail: string; latencyMs: number };

export type LocalLlmConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Injected by tests; the global fetch otherwise. */
  fetch?: typeof fetch;
};

export type LocalChatRequest<T> = {
  system: string;
  user: string;
  /** Validates the answer, and is sent to Ollama as the `format` JSON schema. */
  schema: z.ZodType<T>;
};

export interface LocalLlmClient {
  readonly model: string;
  chatJson<T>(request: LocalChatRequest<T>): Promise<LocalLlmResult<T>>;
}

/** The slice of Ollama's `/api/chat` reply that is read. */
const ollamaReplySchema = z.object({
  message: z.object({ content: z.string() }),
});

export function createLocalLlmClient(config: LocalLlmConfig): LocalLlmClient {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/chat`;

  return {
    model: config.model,

    async chatJson<T>({ system, user, schema }: LocalChatRequest<T>) {
      const startedAt = Date.now();
      const elapsed = () => Date.now() - startedAt;
      const fail = (reason: LocalLlmFailure, detail: string): LocalLlmResult<T> => ({
        ok: false,
        reason,
        detail,
        latencyMs: elapsed(),
      });

      // Our own timer rather than AbortSignal.timeout, so a timeout is told
      // apart from any other abort by a flag we set, not by an error name.
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      let content: string;
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            stream: false,
            format: z.toJSONSchema(schema),
            // Classification, not writing: the same sentence should get the
            // same answer.
            options: { temperature: 0 },
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });

        if (!response.ok) {
          return fail("http", `${response.status} ${await safeText(response)}`);
        }

        const reply = ollamaReplySchema.safeParse(await response.json());
        if (!reply.success) return fail("schema", "unexpected Ollama reply shape");
        content = reply.data.message.content;
      } catch (error) {
        if (timedOut) return fail("timeout", `no answer within ${config.timeoutMs}ms`);
        return fail("connection", error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(timer);
      }

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        return fail("parse", content.slice(0, 200));
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        return fail("schema", z.prettifyError(parsed.error).slice(0, 300));
      }
      return { ok: true, data: parsed.data, latencyMs: elapsed() };
    },
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}
