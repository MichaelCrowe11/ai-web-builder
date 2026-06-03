import { describe, it, expect, vi } from "vitest";
import { postWithCapacityRetry } from "./generate-fetch";

function res(status: number, body: any, headers: Record<string, string> = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
    clone() { return this; },
  } as unknown as Response;
}

describe("postWithCapacityRetry", () => {
  it("returns immediately on a 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(200, { ok: true }));
    const r = await postWithCapacityRetry("/api/x", { a: 1 }, { fetchImpl, sleep: async () => {} });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 at_capacity, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(503, { error: "at_capacity", retryAfterMs: 10 }))
      .mockResolvedValueOnce(res(503, { error: "at_capacity", retryAfterMs: 10 }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const onQueued = vi.fn();
    const r = await postWithCapacityRetry("/api/x", {}, { fetchImpl, sleep: async () => {}, onQueued, maxRetries: 5 });
    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onQueued).toHaveBeenCalled();
  });

  it("gives up after maxRetries and returns the last 503", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(503, { error: "at_capacity", retryAfterMs: 5 }));
    const r = await postWithCapacityRetry("/api/x", {}, { fetchImpl, sleep: async () => {}, maxRetries: 2 });
    expect(r.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("passes a non-503 response straight through (no retry)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(402, { error: "out of quota" }));
    const r = await postWithCapacityRetry("/api/x", {}, { fetchImpl, sleep: async () => {} });
    expect(r.status).toBe(402);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
