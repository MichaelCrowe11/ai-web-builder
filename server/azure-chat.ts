// Resilient Azure OpenAI chat transport.
//
// Retries 429 / 408 / 5xx with exponential backoff (honoring the Retry-After
// header when present), then falls back across a list of model deployments.
// Throws only when every model is exhausted. This is pure transport: callers
// own the prompt and the parsing. Replaces the prior single-shot fetch that
// surfaced any 429 as a user-facing "Failed to generate site".

export interface AzureChatOpts {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  models: string[]; // primary first, then fallbacks
  maxRetriesPerModel?: number; // default 3
  baseDelayMs?: number; // default 600
  fetchImpl?: typeof fetch; // injectable for tests
  sleep?: (ms: number) => Promise<void>; // injectable for tests
}

const isGpt5 = (model: string) => /^gpt-5/i.test(model);

function buildBody(model: string, messages: { role: string; content: string }[], maxTokens: number) {
  const body: Record<string, unknown> = { messages };
  if (isGpt5(model)) {
    // gpt-5 family rejects max_tokens and a custom temperature.
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.6;
  }
  return body;
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

export async function azureChat(
  messages: { role: string; content: string }[],
  maxTokens: number,
  opts: AzureChatOpts,
): Promise<string> {
  const {
    endpoint,
    apiKey,
    apiVersion,
    models,
    maxRetriesPerModel = 3,
    baseDelayMs = 600,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = opts;

  if (!endpoint || !apiKey) {
    throw new Error("Azure not configured: set AZURE_CORE_ENDPOINT and AZURE_CORE_API_KEY");
  }
  if (!models.length) throw new Error("azureChat: no models provided");

  let lastErr: Error | null = null;

  for (const model of models) {
    const url = `${endpoint.replace(/\/$/, "")}/openai/deployments/${model}/chat/completions?api-version=${apiVersion}`;

    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": apiKey },
          body: JSON.stringify(buildBody(model, messages, maxTokens)),
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
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? "";
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

  throw lastErr ?? new Error("azureChat: all models failed");
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
