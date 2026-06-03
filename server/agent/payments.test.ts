import { describe, it, expect } from "vitest";
import { FakeVerifier, DisabledVerifier } from "./payments";

function reqWith(header?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? header : undefined) };
}

describe("FakeVerifier", () => {
  it("challenge carries price + pay-to + resource", () => {
    const v = new FakeVerifier();
    const c = v.challenge(1.5, "/v1/agent/sites");
    expect(c.priceUsdc).toBe(1.5);
    expect(c.payTo).toBeTruthy();
    expect(c.resource).toBe("/v1/agent/sites");
  });
  it("verify returns null when no payment header (=> 402)", async () => {
    const v = new FakeVerifier();
    expect(await v.verify(reqWith(undefined), 1)).toBeNull();
  });
  it("verify returns a result when the magic header is present; settle records it", async () => {
    const v = new FakeVerifier();
    const result = await v.verify(reqWith("fake-ok"), 1);
    expect(result).not.toBeNull();
    expect(v.settled).toBe(0);
    await v.settle(result!);
    expect(v.settled).toBe(1);
  });
});

describe("DisabledVerifier", () => {
  it("verify always returns null (no free sites when unconfigured)", async () => {
    const v = new DisabledVerifier();
    expect(await v.verify(reqWith("fake-ok"), 1)).toBeNull();
  });
  it("challenge says unavailable", () => {
    expect(new DisabledVerifier().challenge(1, "/x").unavailable).toBe(true);
  });
});
