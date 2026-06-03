import { describe, it, expect, vi } from "vitest";
import { requirePayment } from "./x402-middleware";
import { FakeVerifier, DisabledVerifier } from "./payments";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.set = (k: string, v: string) => { res.headers[k] = v; return res; };
  return res;
}
function mockReq(header?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? header : undefined), path: "/v1/agent/sites" };
}

describe("requirePayment", () => {
  it("returns 402 + challenge when unpaid", async () => {
    const mw = requirePayment(() => 1.0, new FakeVerifier());
    const res = mockRes(); const next = vi.fn();
    await mw(mockReq(undefined), res, next);
    expect(res.statusCode).toBe(402);
    expect(res.body.accepts?.[0]?.maxAmountRequired).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next and attaches settlePayment when paid", async () => {
    const verifier = new FakeVerifier();
    const mw = requirePayment(() => 1.0, verifier);
    const req = mockReq("fake-ok"); const res = mockRes(); const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(typeof req.settlePayment).toBe("function");
    expect(verifier.settled).toBe(0);       // not settled yet — route settles on success
    await req.settlePayment();
    expect(verifier.settled).toBe(1);
  });

  it("returns 503 payments-unavailable for DisabledVerifier", async () => {
    const mw = requirePayment(() => 1.0, new DisabledVerifier());
    const res = mockRes(); const next = vi.fn();
    await mw(mockReq("fake-ok"), res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("payments_unavailable");
    expect(next).not.toHaveBeenCalled();
  });
});
