import { describe, it, expect, vi } from "vitest";
import { X402Verifier } from "./x402-verifier";

function reqWith(payment?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? payment : undefined), path: "/v1/agent/sites" };
}

// A well-formed X-PAYMENT header: base64-encoded JSON PaymentPayload.
function paymentHeader(payload: object = { x402Version: 1, scheme: "exact", network: "base", payload: { signature: "0xsig", authorization: {} } }): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

const cfg = { payTo: "0xabc", facilitatorUrl: "https://facil.test", network: "base", baseUrl: "https://app.test" };

describe("X402Verifier", () => {
  it("challenge supplies atomic micro-USDC maxAmountRequired and configured fields", () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    const c = v.challenge(1.5, "/v1/agent/sites");
    expect(c.payTo).toBe("0xabc");
    expect(c.network).toBe("base");
    expect(c.maxAmountRequired).toBe("1500000"); // 1.5 USDC * 1e6
    expect(fetchImpl).not.toHaveBeenCalled();     // challenge is synchronous, no facilitator call
  });

  it("challenge defaults the asset to the network's USDC contract with its EIP-712 domain", () => {
    const v = new X402Verifier(cfg, vi.fn());
    const c = v.challenge(1, "/v1/agent/sites");
    expect(c.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"); // USDC on Base
    expect(c.extra).toEqual({ name: "USD Coin", version: "2" });
    expect(c.resource).toBe("https://app.test/v1/agent/sites"); // absolute per spec
    expect(c.maxTimeoutSeconds).toBeGreaterThan(0);
  });

  it("challenge honors explicit asset overrides", () => {
    const v = new X402Verifier({ ...cfg, asset: "0xdef", assetName: "TestUSD", assetVersion: "9" }, vi.fn());
    const c = v.challenge(1, "/x");
    expect(c.asset).toBe("0xdef");
    expect(c.extra).toEqual({ name: "TestUSD", version: "9" });
  });

  it("verify returns null when no X-PAYMENT header (no facilitator call)", async () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(undefined), 1)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verify returns null on an undecodable X-PAYMENT header (no facilitator call)", async () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith("not-base64-json"), 1)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // settle() runs only after the build, so an authorization that is valid NOW but
  // expires seconds later passes the facilitator's /verify and then fails /settle —
  // buying a site for free. The floor is enforced here, before any facilitator call.
  function headerExpiringIn(seconds: number): string {
    const validBefore = String(Math.floor(Date.now() / 1000) + seconds);
    return paymentHeader({
      x402Version: 1, scheme: "exact", network: "base",
      payload: { signature: "0xsig", authorization: { validBefore } },
    });
  }

  it("verify rejects an authorization expiring too soon to survive the build", async () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(headerExpiringIn(30)), 1)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled(); // rejected before we bother the facilitator
  });

  it("verify accepts an authorization with ample runway", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(headerExpiringIn(3600)), 1)).not.toBeNull();
  });

  it("minSettleRunwaySeconds is configurable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true }) });
    const v = new X402Verifier({ ...cfg, minSettleRunwaySeconds: 10 }, fetchImpl);
    expect(await v.verify(reqWith(headerExpiringIn(30)), 1)).not.toBeNull(); // 30s clears a 10s floor
  });

  it("verify posts spec body to /verify and returns a result when facilitator says valid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    const r = await v.verify(reqWith(paymentHeader()), 1);
    expect(r).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith("https://facil.test/verify", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.x402Version).toBe(1);
    expect(body.paymentPayload).toMatchObject({ scheme: "exact", network: "base" }); // decoded object, not the raw header
    expect(body.paymentRequirements).toMatchObject({
      scheme: "exact",
      network: "base",
      payTo: "0xabc",
      maxAmountRequired: "1000000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: { name: "USD Coin", version: "2" },
      resource: "https://app.test/v1/agent/sites",
    });
  });

  it("verify returns null when facilitator says invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: false }) });
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(paymentHeader()), 1)).toBeNull();
  });

  it("settle posts the same payload + requirements pair to /settle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    const r = await v.verify(reqWith(paymentHeader()), 1);
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await v.settle(r!);
    expect(fetchImpl).toHaveBeenLastCalledWith("https://facil.test/settle", expect.objectContaining({ method: "POST" }));
    const verifyBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const settleBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(settleBody.paymentPayload).toEqual(verifyBody.paymentPayload);
    expect(settleBody.paymentRequirements).toEqual(verifyBody.paymentRequirements);
  });

  it("settle throws when the facilitator reports HTTP failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const v = new X402Verifier(cfg, fetchImpl);
    await expect(v.settle({ proof: { paymentPayload: {}, paymentRequirements: {} }, priceUsdc: 1 })).rejects.toThrow("x402 settle failed");
  });

  it("settle throws when the facilitator responds ok but success: false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, errorReason: "insufficient_funds" }) });
    const v = new X402Verifier(cfg, fetchImpl);
    await expect(v.settle({ proof: { paymentPayload: {}, paymentRequirements: {} }, priceUsdc: 1 })).rejects.toThrow("x402 settle failed");
  });

  it("verify returns null (does NOT throw) when the facilitator responds with ok: false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(paymentHeader()), 1)).toBeNull();
  });

  it("challenge atomic conversion is consistent across prices", () => {
    const v = new X402Verifier(cfg, vi.fn());
    expect(v.challenge(0.25, "/v1/agent/sites").maxAmountRequired).toBe("250000");
    expect(v.challenge(1, "/v1/agent/sites").maxAmountRequired).toBe("1000000");
    expect(v.challenge(1.5, "/v1/agent/sites").maxAmountRequired).toBe("1500000");
  });
});
