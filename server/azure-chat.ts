// Resilient Azure OpenAI chat transport.
//
// Retries 429 / 408 / 5xx with exponential backoff (honoring the Retry-After
// header when present), then falls back across a list of model deployments.
// Throws only when every model is exhausted. This is pure transport: callers
// own the prompt and the parsing. Replaces the prior single-shot fetch that
// surfaced any 429 as a user-facing "Failed to generate site".
// Two entry points: azureChat (text) and azureChatTools (OpenAI-style tool calling).
//
// A chain is provider-mixed: each model is resolved through ./providers, so an
// Azure Foundry deployment can fall back to a Cloudflare Workers AI model (or
// the reverse) inside one request. Both speak the OpenAI wire format, so
// everything below this comment is provider-agnostic.

import { resolveTarget } from "./providers";

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
  /** Reasoning models (GLM 5.2 among them) emit their scratchpad separately.
   *  It is never shown to a user and never parsed; it matters only because it
   *  is billed against max_tokens, so a thinking model can spend its whole
   *  budget before it writes a single character of answer. */
  reasoning_content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
}

/** True when a model thought until it ran out of room and never answered.
 *  The response is a valid 200 with an empty `content`, so without this check it
 *  surfaces downstream as "could not parse response as JSON" rather than as the
 *  budget problem it actually is. Tool calls legitimately carry null content, so
 *  they are not a miss. */
function isEmptyAnswer(msg: RawAssistantMessage): boolean {
  const hasText = typeof msg.content === "string" && msg.content.trim().length > 0;
  return !hasText && !(msg.tool_calls && msg.tool_calls.length > 0);
}

const isGpt5 = (model: string) => /^gpt-5/i.test(model);

function buildBody(
  model: string,
  messages: unknown[],
  maxTokens: number,
  tools?: ToolDef[],
  stream?: boolean,
  bodyModel?: string,
) {
  const body: Record<string, unknown> = { messages };
  // Azure names the deployment in the URL; OpenAI-compatible surfaces such as
  // Cloudflare Workers AI expect it in the body instead.
  if (bodyModel) body.model = bodyModel;
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

  if (!models.length) throw new Error("azureCompletion: no models provided");

  let lastErr: Error | null = null;
  let reachable = 0;

  for (const model of models) {
    // A chain may name models whose cloud has no credentials here. Skip those
    // rather than failing the whole request: the next model may be reachable.
    const target = resolveTarget(model, { endpoint, apiKey, apiVersion });
    if (!target) continue;
    reachable++;
    const { url, headers, bodyModel } = target;

    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(
            buildBody(model, messages, maxTokens, tools, Boolean(onDelta), bodyModel),
          ),
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
          const msg: RawAssistantMessage = onDelta && res.body
            ? await readSseStream(res.body, onDelta)
            : ((await res.json()).choices?.[0]?.message ?? {});
          if (isEmptyAnswer(msg)) {
            // Retry once on the same model (thinking length varies run to run),
            // then hand off to the next one rather than returning silence.
            lastErr = new Error(
              `${target.provider} ${model} returned no answer` +
                (msg.reasoning_content ? " (spent its token budget reasoning)" : ""),
            );
            if (attempt < maxRetriesPerModel) {
              await sleep(backoffMs(null, attempt, baseDelayMs));
              continue;
            }
            break;
          }
          return msg;
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
      lastErr = new Error(`${target.provider} ${model} returned ${res.status}: ${detail}`);

      if (isRetryable(res.status) && attempt < maxRetriesPerModel) {
        await sleep(backoffMs(res.headers.get("retry-after"), attempt, baseDelayMs));
        continue;
      }
      break; // non-retryable status, or retries exhausted: fall back to next model
    }
  }

  if (!reachable) {
    throw new Error(
      "No model provider configured: set AZURE_CORE_ENDPOINT and AZURE_CORE_API_KEY " +
        "for Foundry deployments, and/or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN " +
        "for @cf/ models.",
    );
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

// Resolve a TIER-AWARE model fallback chain. Each tier has its own primary
// (env-driven); all tiers share AI_WEBBUILDER_FALLBACK_MODELS as a safety net.
//   "pro"        -> AI_WEBBUILDER_PRO_MODEL
//   "free"       -> AI_WEBBUILDER_FREE_MODEL
//   "anonymous"  -> AI_WEBBUILDER_ANON_MODEL   (also the default when plan is absent)
// Any tier falls back to AI_WEBBUILDER_MODEL, then the shared fallback list.
//
// Defaults run on Cloudflare Workers AI, which Crowe Logic holds funded credit
// on, and fall back to Azure Foundry. Pro leads with a code-specialised model
// because this product's real output is a structured document, not prose. A
// chain that names a cloud this environment has no keys for simply skips it
// (see ./providers), so these defaults are safe on an Azure-only deployment.
export const DEFAULT_ANON_MODEL = "@cf/zai-org/glm-5.2";
export const DEFAULT_FREE_MODEL = "@cf/zai-org/glm-5.2";
export const DEFAULT_PRO_MODEL = "@cf/moonshotai/kimi-k2.7-code";
export const DEFAULT_FALLBACKS = "@cf/zai-org/glm-5.2,model-router,DeepSeek-V4-Flash";

export function modelsFromEnvForPlan(plan?: string | null): string[] {
  const fallbacks = (process.env.AI_WEBBUILDER_FALLBACK_MODELS ?? DEFAULT_FALLBACKS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base = process.env.AI_WEBBUILDER_MODEL ?? "";
  let primary: string;
  if (plan === "pro") {
    primary = process.env.AI_WEBBUILDER_PRO_MODEL ?? base ?? "";
    if (!primary) primary = DEFAULT_PRO_MODEL;
  } else if (plan === "free") {
    primary = process.env.AI_WEBBUILDER_FREE_MODEL ?? base ?? "";
    if (!primary) primary = DEFAULT_FREE_MODEL;
  } else {
    primary = process.env.AI_WEBBUILDER_ANON_MODEL ?? base ?? "";
    if (!primary) primary = DEFAULT_ANON_MODEL;
  }
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

// Back-compat: callers without a tier get the anonymous/default chain.
export function modelsFromEnv(): string[] {
  return modelsFromEnvForPlan();
}

// Task-aware routing.
//
// Tier alone is the wrong axis for this product. What a request needs depends on
// what it is doing, and the two Cloudflare models behave very differently:
//
//   @cf/moonshotai/kimi-k2.7-code  answers directly. Measured: 2 tokens to reply "OK".
//   @cf/zai-org/glm-5.2            reasons first. Measured: 113 completion tokens
//                                  of scratchpad to reply "OK", billed to max_tokens.
//
// So a job whose output is a large structured document wants the code model in
// front, or the thinking eats the budget the document needed and the response
// truncates mid-JSON. A job that is genuinely a judgement call wants the
// reasoning model in front. Each still falls through to the other, then to Azure.
export type ModelTask = "generate" | "refine" | "plan" | "chat";

const CODE_FIRST = ["@cf/moonshotai/kimi-k2.7-code", "@cf/zai-org/glm-5.2"];
const REASON_FIRST = ["@cf/zai-org/glm-5.2", "@cf/moonshotai/kimi-k2.7-code"];

const TASK_CHAINS: Record<ModelTask, string[]> = {
  generate: CODE_FIRST, // a whole site document, emitted as JSON
  refine: CODE_FIRST, // a scoped patch to that document
  plan: REASON_FIRST, // choosing what to change and why
  chat: REASON_FIRST, // conversation with the builder
};

/** Per-task override, e.g. AI_WEBBUILDER_GENERATE_MODELS="a,b". */
function taskOverride(task: ModelTask): string[] | null {
  const raw = process.env[`AI_WEBBUILDER_${task.toUpperCase()}_MODELS`];
  if (!raw) return null;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

/** The chain for a task, ending in the tier chain so Azure stays the safety net. */
export function modelsForTask(task: ModelTask, plan?: string | null): string[] {
  const head = taskOverride(task) ?? TASK_CHAINS[task];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of [...head, ...modelsFromEnvForPlan(plan)]) {
    if (!seen.has(m)) {
      seen.add(m);
      ordered.push(m);
    }
  }
  return ordered;
}
