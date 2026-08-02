import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { azureChat, azureChatTools, modelsForTask, type ToolDef } from "./azure-chat";

// Build a fake Response with just the bits azureChat reads.
function resp(status: number, body: unknown, headers: Record<string, string> = {}) {
  const ok = status >= 200 && status < 300;
  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return {
    ok,
    status,
    headers: { get: (h: string) => lower[h.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const ok = (content: string) => resp(200, { choices: [{ message: { content } }] });
const rate = (retryAfter?: string) =>
  resp(429, { error: { code: "RateLimitReached" } }, retryAfter ? { "retry-after": retryAfter } : {});

const baseOpts = {
  endpoint: "https://x.example.com",
  apiKey: "k",
  apiVersion: "2024-12-01-preview",
  sleep: async () => {}, // no real waiting in tests
};

describe("azureChat", () => {
  it("returns content on first success", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("hello"));
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 on the same model, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(rate())
      .mockResolvedValueOnce(ok("recovered"));
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 3, fetchImpl,
    });
    expect(out).toBe("recovered");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors the Retry-After header for the backoff delay", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(rate("2")).mockResolvedValueOnce(ok("ok"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 3, fetchImpl, sleep,
    });
    expect(sleep).toHaveBeenCalledWith(2000); // 2s, from Retry-After
  });

  it("falls back to the next model after exhausting retries on the first", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(rate()) // gpt-4o attempt 1
      .mockResolvedValueOnce(rate()) // gpt-4o attempt 2 (retries exhausted)
      .mockResolvedValueOnce(ok("from-router")); // model-router attempt 1
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["gpt-4o", "model-router"], maxRetriesPerModel: 1, fetchImpl,
    });
    expect(out).toBe("from-router");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uses max_completion_tokens for gpt-5 family, max_tokens otherwise", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok("x"));
    await azureChat([{ role: "user", content: "hi" }], 777, {
      ...baseOpts, models: ["gpt-5.4-mini"], fetchImpl,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_completion_tokens).toBe(777);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined(); // gpt-5 rejects custom temperature
  });

  it("throws after all models are exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(rate());
    await expect(
      azureChat([{ role: "user", content: "hi" }], 100, {
        ...baseOpts, models: ["gpt-4o", "model-router"], maxRetriesPerModel: 1, fetchImpl,
      }),
    ).rejects.toThrow();
  });
});

const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "read_site", description: "Read the site outline", parameters: { type: "object", properties: {} } } },
];

const okTool = (name: string, args: string) =>
  resp(200, { choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }] } }] });

describe("azureChatTools", () => {
  it("returns tool calls when the model requests them", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okTool("read_site", "{}"));
    const out = await azureChatTools([{ role: "user", content: "darker hero" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out.toolCalls).toEqual([{ id: "call_1", name: "read_site", arguments: "{}" }]);
    expect(out.content).toBeNull();
  });

  it("returns final text when the model answers without tools", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("All done."));
    const out = await azureChatTools([{ role: "user", content: "thanks" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out.content).toBe("All done.");
    expect(out.toolCalls).toEqual([]);
  });

  it("sends tools and tool_choice in the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("x"));
    await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toEqual(TOOLS);
    expect(body.tool_choice).toBe("auto");
  });

  it("retries a 429 with the same retry semantics as azureChat", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(rate())
      .mockResolvedValueOnce(okTool("read_site", "{}"));
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 3, fetchImpl,
    });
    expect(out.toolCalls).toHaveLength(1);
  });

  it("drops malformed tool calls (missing id or name) instead of emitting broken entries", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(resp(200, { choices: [{ message: { content: null, tool_calls: [
      { type: "function", function: { name: "read_site", arguments: "{}" } },              // no id
      { id: "call_2", type: "function", function: { arguments: "{}" } },                    // no name
      { id: "call_3", type: "function", function: { name: "read_section" } },               // no arguments
    ] } }] }));
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out.toolCalls).toEqual([{ id: "call_3", name: "read_section", arguments: "{}" }]);
  });
});

// ---- streaming (onDelta) ----

// Build a fake streaming Response whose body yields the given SSE frames.
function streamResp(frames: string[], failAfter?: number) {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && i >= failAfter) {
        controller.error(new Error("stream died mid-read"));
        return;
      }
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(frames[i++]));
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body,
    json: async () => { throw new Error("streaming response: use body"); },
    text: async () => "",
  } as unknown as Response;
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const contentChunk = (text: string) => sse({ choices: [{ delta: { content: text } }] });

describe("azureChatTools streaming", () => {
  it("forwards content deltas and returns the assembled reply", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(streamResp([
      contentChunk("Tight"),
      contentChunk("ened the headline."),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl, onDelta: (t) => deltas.push(t),
    });
    expect(deltas).toEqual(["Tight", "ened the headline."]);
    expect(out.content).toBe("Tightened the headline.");
    expect(out.toolCalls).toEqual([]);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
  });

  it("accumulates fragmented tool_calls across chunks without emitting them as text", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(streamResp([
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "edit_section", arguments: "" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"index"' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } }] }),
      "data: [DONE]\n\n",
    ]));
    const deltas: string[] = [];
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl, onDelta: (t) => deltas.push(t),
    });
    expect(deltas).toEqual([]);
    expect(out.toolCalls).toEqual([{ id: "c1", name: "edit_section", arguments: '{"index":1}' }]);
  });

  it("does not request streaming when onDelta is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okTool("read_site", "{}"));
    await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBeUndefined();
  });

  it("retries a mid-stream failure; duplicate deltas are tolerated (turn_done replaces)", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(streamResp([contentChunk("Tigh")], 1)) // dies after one chunk
      .mockResolvedValueOnce(streamResp([contentChunk("Done."), "data: [DONE]\n\n"]));
    const deltas: string[] = [];
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 3, fetchImpl, onDelta: (t) => deltas.push(t),
    });
    expect(out.content).toBe("Done.");
    expect(deltas).toEqual(["Tigh", "Done."]); // both attempts' deltas — client reconciles at turn_done
  });
});

// A fallback chain may name models on two clouds. The transport resolves each
// one and skips any whose provider has no credentials in this environment,
// which is what lets one chain serve an Azure-only box and a both-clouds box.
describe("provider-mixed chains", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_API_KEY;
  });
  afterEach(() => { process.env = { ...savedEnv }; });

  it("sends a @cf/ model to Cloudflare with a bearer token and the model in the body", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_API_TOKEN = "cf-token";
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("from cloudflare"));
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["@cf/zai-org/glm-5.2"], fetchImpl,
    });
    expect(out).toBe("from cloudflare");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/accounts/acct123/ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer cf-token");
    expect(JSON.parse(init.body as string).model).toBe("@cf/zai-org/glm-5.2");
  });

  it("skips an unreachable cloud and serves from the next model in the chain", async () => {
    // No Cloudflare credentials: the @cf/ primary is skipped without burning a
    // retry, and Azure answers. Exactly one request is made.
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("from azure"));
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["@cf/moonshotai/kimi-k2.7-code", "gpt-4o"], fetchImpl,
    });
    expect(out).toBe("from azure");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("/openai/deployments/gpt-4o/");
  });

  it("falls across clouds when the first one errors", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_API_TOKEN = "cf-token";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(resp(400, { error: "bad model" })) // non-retryable on CF
      .mockResolvedValueOnce(ok("azure caught it"));
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["@cf/zai-org/glm-5.2", "gpt-4o"], fetchImpl,
    });
    expect(out).toBe("azure caught it");
    expect(fetchImpl.mock.calls[0][0]).toContain("api.cloudflare.com");
    expect(fetchImpl.mock.calls[1][0]).toContain("/openai/deployments/gpt-4o/");
  });

  it("names the failing cloud in the error, so logs say where it broke", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_API_TOKEN = "cf-token";
    const fetchImpl = vi.fn().mockResolvedValue(resp(400, { error: "nope" }));
    await expect(
      azureChat([{ role: "user", content: "hi" }], 100, {
        ...baseOpts, models: ["@cf/zai-org/glm-5.2"], fetchImpl,
      }),
    ).rejects.toThrow(/cloudflare @cf\/zai-org\/glm-5\.2 returned 400/);
  });

  it("explains what to configure when no model in the chain is reachable", async () => {
    const fetchImpl = vi.fn();
    await expect(
      azureChat([{ role: "user", content: "hi" }], 100, {
        ...baseOpts, endpoint: "", apiKey: "", models: ["@cf/zai-org/glm-5.2", "gpt-4o"], fetchImpl,
      }),
    ).rejects.toThrow(/No model provider configured/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("task-aware routing", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("AI_WEBBUILDER_")) delete process.env[k];
    }
  });
  afterEach(() => { process.env = { ...savedEnv }; });

  it("puts the code model first for work that emits a document", () => {
    expect(modelsForTask("generate")[0]).toBe("@cf/moonshotai/kimi-k2.7-code");
    expect(modelsForTask("refine")[0]).toBe("@cf/moonshotai/kimi-k2.7-code");
  });

  it("puts the reasoning model first for judgement calls", () => {
    expect(modelsForTask("plan")[0]).toBe("@cf/zai-org/glm-5.2");
    expect(modelsForTask("chat")[0]).toBe("@cf/zai-org/glm-5.2");
  });

  it("keeps the other model as the immediate fallback, not a dead end", () => {
    expect(modelsForTask("generate")[1]).toBe("@cf/zai-org/glm-5.2");
    expect(modelsForTask("plan")[1]).toBe("@cf/moonshotai/kimi-k2.7-code");
  });

  it("still ends in the Azure safety net", () => {
    const chain = modelsForTask("generate", "pro");
    expect(chain).toContain("model-router");
    expect(chain).toContain("DeepSeek-V4-Flash");
  });

  it("never repeats a model, so one failure is not retried as two", () => {
    const chain = modelsForTask("generate", "pro"); // pro's primary is also the task head
    expect(new Set(chain).size).toBe(chain.length);
  });

  it("honours a per-task override", () => {
    process.env.AI_WEBBUILDER_GENERATE_MODELS = "custom-a, custom-b";
    expect(modelsForTask("generate").slice(0, 2)).toEqual(["custom-a", "custom-b"]);
  });
});

// A reasoning model can return 200 with an empty `content` because it spent the
// whole budget on its scratchpad. Returning that verbatim shows the user an
// empty page and blames the JSON parser, so the transport treats it as a miss.
describe("empty answers from reasoning models", () => {
  const thinking = () => resp(200, {
    choices: [{ message: { role: "assistant", content: "", reasoning_content: "thinking..." } }],
  });

  it("retries, then falls back to the next model", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(thinking())
      .mockResolvedValueOnce(ok("a real answer"));
    const out = await azureChat([{ role: "user", content: "hi" }], 100, {
      ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 2, fetchImpl,
    });
    expect(out).toBe("a real answer");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("says the budget went on reasoning rather than blaming the parser", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(thinking());
    await expect(
      azureChat([{ role: "user", content: "hi" }], 100, {
        ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 0, fetchImpl,
      }),
    ).rejects.toThrow(/spent its token budget reasoning/);
  });

  it("does not mistake a tool call for an empty answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okTool("read_site", "{}"));
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out.toolCalls).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry
  });
});
