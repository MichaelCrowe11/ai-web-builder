// Resilient Azure OpenAI chat transport.
//
// Retries 429 / 408 / 5xx with exponential backoff (honoring the Retry-After
// header when present), then falls back across a list of model deployments.
// Throws only when every model is exhausted. This is pure transport: callers
// own the prompt and the parsing. Replaces the prior single-shot fetch that
// surfaced any 429 as a user-facing "Failed to generate site".
// Two entry points: azureChat (text) and azureChatTools (OpenAI-style tool calling).

export interface AzureChatOpts {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  models: string[]; // primary first, then fallbacks
  maxRetriesPerModel?: number; // default 3
  baseDelayMs?: number; // default 600
  fetchImpl?: typeof fetch; // injectable for tests
  sleep?: (ms: number) => Promise<void>; // injectable for tests
  /** When set, the request streams and content fragments are forwarded here as
   *  they arrive. Deltas are OPTIMISTIC: a mid-stream retry/fallback re-emits —
   *  callers must treat the returned (assembled) message as authoritative. */
  onDelta?: (text: string) => void;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// OpenAI wire-format messages for tool-calling conversations.
export type ToolWireMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AssistantToolTurn {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

interface RawAssistantMessage {
  content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
}

const isGpt5 = (model: string) => /^gpt-5/i.test(model);

function buildBody(model: string, messages: unknown[], maxTokens: number, tools?: ToolDef[], stream?: boolean) {
  const body: Record<string, unknown> = { messages };
  if (isGpt5(model)) {
    // gpt-5 family rejects max_tokens and a custom temperature.
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.6;
  }
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (stream) body.stream = true;
  return body;
}

// Read an OpenAI-style SSE stream: forward content deltas, accumulate
// fragmented tool_calls by index, return the assembled assistant message.
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<RawAssistantMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let sawContent = false;
  const calls = new Map<number, { id?: string; name?: string; arguments: string }>();

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") return;
    let chunk: any;
    try { chunk = JSON.parse(payload); } catch { return; } // skip malformed keep-alives
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return; // Azure emits content-filter preludes with empty choices
    if (typeof delta.content === "string" && delta.content.length) {
      content += delta.content;
      sawContent = true;
      onDelta(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = typeof tc.index === "number" ? tc.index : 0;
      const cur = calls.get(idx) ?? { arguments: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name = tc.function.name;
      if (typeof tc.function?.arguments === "string") cur.arguments += tc.function.arguments;
      calls.set(idx, cur);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handleLine(buf.slice(0, nl).replace(/\r$/, ""));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) handleLine(buf);

  return {
    content: sawContent ? content : null,
    tool_calls: Array.from(calls.entries())
      .sort(([a], [b]) => a - b)
      .map(([, c]) => ({ id: c.id, function: { name: c.name, arguments: c.arguments } })),
  };
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

function backoffMs(retryAfter: string | null, attempt: number, base: number): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (!Number.isNaN(secs)) return secs * 1000;
  }
  return base * 2 ** attempt + Math.floor(Math.random() * 100);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Private shared core: runs the full retry/fallback loop and returns the raw
// message object from the first successful response. Both azureChat and
// azureChatTools delegate here; the wrappers narrow the return to their types.
async function azureCompletion(
  messages: unknown[],
  maxTokens: number,
  opts: AzureChatOpts,
  tools?: ToolDef[],
): Promise<RawAssistantMessage> {
  const {
    endpoint,
    apiKey,
    apiVersion,
    models,
    maxRetriesPerModel = 3,
    baseDelayMs = 600,
    fetchImpl = fetch,
    sleep = defaultSleep,
    onDelta,
  } = opts;

  if (!endpoint || !apiKey) {
    throw new Error("Azure not configured: set AZURE_CORE_ENDPOINT and AZURE_CORE_API_KEY");
  }
  if (!models.length) throw new Error("azureCompletion: no models provided");

  let lastErr: Error | null = null;

  for (const model of models) {
    const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`;

    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": apiKey },
          body: JSON.stringify(buildBody(model, messages, maxTokens, tools, Boolean(onDelta))),
        });
      } catch (e) {
        // Network/transport error: treat as retryable.
        lastErr = e as Error;
        if (attempt < maxRetriesPerModel) {
          await sleep(backoffMs(null, attempt, baseDelayMs));
          continue;
        }
        break; // exhausted this model, try the next one
      }

      if (res.ok) {
        try {
          if (onDelta && res.body) return await readSseStream(res.body, onDelta);
          const data = await res.json();
          return data.choices?.[0]?.message ?? {};
        } catch (e) {
          // Mid-stream death is retryable; already-emitted deltas duplicate,
          // which callers reconcile (the final reply replaces streamed text).
          lastErr = e as Error;
          if (attempt < maxRetriesPerModel) {
            await sleep(backoffMs(null, attempt, baseDelayMs));
            continue;
          }
          break;
        }
      }

      const detail = await res.text().catch(() => "");
      lastErr = new Error(`Azure ${model} returned ${res.status}: ${detail}`);

      if (isRetryable(res.status) && attempt < maxRetriesPerModel) {
        await sleep(backoffMs(res.headers.get("retry-after"), attempt, baseDelayMs));
        continue;
      }
      break; // non-retryable status, or retries exhausted: fall back to next model
    }
  }

  throw lastErr ?? new Error("azureCompletion: all models failed");
}

export async function azureChat(
  messages: { role: string; content: string }[],
  maxTokens: number,
  opts: AzureChatOpts,
): Promise<string> {
  const msg = await azureCompletion(messages, maxTokens, opts);
  return msg.content ?? "";
}

export async function azureChatTools(
  messages: ToolWireMessage[],
  maxTokens: number,
  tools: ToolDef[],
  opts: AzureChatOpts,
): Promise<AssistantToolTurn> {
  const msg = await azureCompletion(messages, maxTokens, opts, tools);
  return {
    content: msg.content ?? null,
    toolCalls: (msg.tool_calls ?? [])
      .filter((c) => c.id != null && c.function?.name != null)
      .map((c) => ({
        id: c.id as string,
        name: c.function!.name as string,
        arguments: c.function?.arguments ?? "{}",
      })),
  };
}

// Resolve the model fallback chain from env: primary first, then any fallbacks.
export function modelsFromEnv(): string[] {
  const primary = process.env.AI_WEBBUILDER_MODEL ?? "gpt-4o";
  const fallbacks = (process.env.AI_WEBBUILDER_FALLBACK_MODELS ?? "model-router,grok-4-1-fast-non-r")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // de-dupe while preserving order (no Set spread: keeps tsconfig target happy)
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of [primary, ...fallbacks]) {
    if (!seen.has(m)) {
      seen.add(m);
      ordered.push(m);
    }
  }
  return ordered;
}
