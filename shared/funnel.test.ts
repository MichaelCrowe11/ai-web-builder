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
      // 10 distinct people landed — the denominator that was missing before.
      ...Array.from({ length: 10 }, (_, i) => ev("landing_view", { anonId: `v${i}` })),
      // Automated clients are recorded but must NOT dilute the funnel.
      ev("bot_view", { anonId: "bot1" }),
      ev("bot_view", { anonId: "bot2" }),
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
      // and one lapsed subscriber, so gross conversions can be read net
      ev("pro_churned", { userId: "u9" }),
    ];

    const f = buildAcquisitionFunnel(events, 1000);
    const byEvent = Object.fromEntries(f.stages.map((s) => [s.event, s]));

    expect(byEvent["landing_view"].subjects).toBe(10);
    expect(byEvent["anon_trial_start"].subjects).toBe(4);
    expect(byEvent["anon_trial_start"].events).toBe(5); // repeat counted in events
    expect(byEvent["signup"].subjects).toBe(2);
    expect(byEvent["checkout_start"].subjects).toBe(1);
    expect(byEvent["pro_converted"].subjects).toBe(1);

    // ofTop is now relative to everyone who LANDED (10), not to those who had
    // already engaged — which is what makes the arrive-and-leave drop visible.
    expect(byEvent["anon_trial_start"].ofTop).toBe(40); // 4/10 — the activation rate
    expect(byEvent["signup"].ofTop).toBe(20); // 2/10
    expect(byEvent["pro_converted"].ofTop).toBe(10); // 1/10
    // stepRate is relative to the previous stage
    expect(byEvent["anon_trial_start"].stepRate).toBe(40); // 4/10
    expect(byEvent["signup"].stepRate).toBe(50); // 2/4
    expect(byEvent["checkout_start"].stepRate).toBe(50); // 1/2
    expect(byEvent["pro_converted"].stepRate).toBe(100); // 1/1

    // Bots are counted apart and never appear as a funnel stage.
    expect(f.botViews).toBe(2);
    expect(f.stages.some((s) => s.event === "bot_view")).toBe(false);

    expect(f.trialExhausted).toBe(1);
    expect(f.freeLimitReached).toBe(1);
    expect(f.proChurned).toBe(1);
  });

  it("is safe on an empty event set", () => {
    const f = buildAcquisitionFunnel([], 1000);
    expect(f.stages).toHaveLength(5);
    expect(f.stages.every((s) => s.subjects === 0 && s.ofTop === 0 && s.stepRate === 0)).toBe(true);
    expect(f.trialExhausted).toBe(0);
    expect(f.botViews).toBe(0);
    expect(f.proChurned).toBe(0);
  });
});
