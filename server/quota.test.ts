import { describe, it, expect } from "vitest";
import { quotaSnapshot } from "./quota";

// Minimal fake request: anonymous session, fixed IP.
function fakeReq(ip = "10.0.0.1") {
  return { session: {}, headers: {}, ip, socket: { remoteAddress: ip } } as any;
}

describe("quotaSnapshot", () => {
  it("returns ok=true with state for a fresh anonymous IP", async () => {
    const snap = await quotaSnapshot(fakeReq("10.9.9.1"));
    expect(snap.ok).toBe(true);
    expect(snap.state.plan).toBe("anonymous");
    expect(snap.state.remaining).toBeGreaterThan(0);
  });

  it("returns ok=false (not a thrown error) when the anonymous bucket is exhausted", async () => {
    const req = fakeReq("10.9.9.2");
    const first = await quotaSnapshot(req);
    const limit = first.state.limit as number;
    // Drain the bucket via the consume test hook.
    for (let i = 0; i < limit; i++) await quotaSnapshot(req, { consume: true });
    const snap = await quotaSnapshot(req);
    expect(snap.ok).toBe(false);
    expect(snap.state.remaining).toBe(0);
  });
});
