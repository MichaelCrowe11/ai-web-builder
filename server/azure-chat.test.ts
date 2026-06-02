import { describe, it, expect, vi } from "vitest";
import { azureChat } from "./azure-chat";

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
