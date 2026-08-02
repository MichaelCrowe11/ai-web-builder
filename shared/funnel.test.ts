import { describe, it, expect } from "vitest";
import { buildAcquisitionFunnel, type ProductEvent } from "./funnel";

const ev = (event: ProductEvent["event"], subject: { userId?: string; anonId?: string }): ProductEvent => ({
  ts: 1_700_000_000_000,
  event,
  ...subject,
});

describe("buildAcquisitionFunnel", () => {
  it("counts distinct subjects per stage and derives rates", () => {
    const events: ProductEvent[] = [
      // 4 distinct anonymous trials (a1 builds twice — still one person)
      ev("anon_trial_start", { anonId: "a1" }),
      ev("anon_trial_start", { anonId: "a1" }),
      ev("anon_trial_start", { anonId: "a2" }),
      ev("anon_trial_start", { anonId: "a3" }),
      ev("anon_trial_start", { anonId: "a4" }),
      // 2 signups
      ev("signup", { userId: "u1" }),
      ev("signup", { userId: "u2" }),
      // 1 checkout opened
      ev("checkout_start", { userId: "u1" }),
      // 1 converted
      ev("pro_converted", { userId: "u1" }),
      // off-path pressure signals
      ev("trial_exhausted", { anonId: "a2" }),
      ev("free_limit_reached", { userId: "u2" }),
    ];

    const f = buildAcquisitionFunnel(events, 1000);
    const byEvent = Object.fromEntries(f.stages.map((s) => [s.event, s]));

    expect(byEvent["anon_trial_start"].subjects).toBe(4);
    expect(byEvent["anon_trial_start"].events).toBe(5); // repeat counted in events
    expect(byEvent["signup"].subjects).toBe(2);
    expect(byEvent["checkout_start"].subjects).toBe(1);
    expect(byEvent["pro_converted"].subjects).toBe(1);

    // ofTop is relative to the first stage (4 trials)
    expect(byEvent["signup"].ofTop).toBe(50); // 2/4
    expect(byEvent["pro_converted"].ofTop).toBe(25); // 1/4
    // stepRate is relative to the previous stage
    expect(byEvent["signup"].stepRate).toBe(50); // 2/4
    expect(byEvent["checkout_start"].stepRate).toBe(50); // 1/2
    expect(byEvent["pro_converted"].stepRate).toBe(100); // 1/1

    expect(f.trialExhausted).toBe(1);
    expect(f.freeLimitReached).toBe(1);
  });

  it("is safe on an empty event set", () => {
    const f = buildAcquisitionFunnel([], 1000);
    expect(f.stages).toHaveLength(4);
    expect(f.stages.every((s) => s.subjects === 0 && s.ofTop === 0 && s.stepRate === 0)).toBe(true);
    expect(f.trialExhausted).toBe(0);
  });
});
