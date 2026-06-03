import { describe, it, expect, vi } from "vitest";
import { X402Verifier } from "./x402-verifier";

function reqWith(payment?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? payment : undefined), path: "/v1/agent/sites" };
}
const cfg = { payTo: "0xabc", facilitatorUrl: "https://facil.test", network: "base", asset: "USDC" };

describe("X402Verifier", () => {
  it("challenge supplies atomic micro-USDC maxAmountRequired and configured fields (no network)", () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    const c = v.challenge(1.5, "/v1/agent/sites");
    expect(c.payTo).toBe("0xabc");
    expect(c.network).toBe("base");
    expect(c.maxAmountRequired).toBe("1500000"); // 1.5 USDC * 1e6
    expect(fetchImpl).not.toHaveBeenCalled();     // challenge is synchronous, no facilitator call
  });

  it("verify returns null when no X-PAYMENT header (no facilitator call)", async () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(undefined), 1)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verify posts to /verify and returns a result when facilitator says valid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    const r = await v.verify(reqWith("PROOF"), 1);
    expect(r).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith("https://facil.test/verify", expect.objectContaining({ method: "POST" }));
  });

  it("verify returns null when facilitator says invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: false }) });
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith("PROOF"), 1)).toBeNull();
  });

  it("settle posts to /settle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    await v.settle({ proof: "PROOF", priceUsdc: 1 });
    expect(fetchImpl).toHaveBeenCalledWith("https://facil.test/settle", expect.objectContaining({ method: "POST" }));
  });

  it("settle throws when facilitator reports failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const v = new X402Verifier(cfg, fetchImpl);
    await expect(v.settle({ proof: "PROOF", priceUsdc: 1 })).rejects.toThrow();
  });
});
