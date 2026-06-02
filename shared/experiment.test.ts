import { describe, it, expect } from "vitest";
import { assignVariant, decide, experimentSchema, type Experiment } from "@shared/experiment";
import type { VariantStat } from "@shared/telemetry";

const exp = (): Experiment => ({
  id: "e1",
  siteId: "s1",
  status: "running",
  targetSectionId: "0:hero",
  hypothesis: "headline too vague",
  conversionEvent: "checkout_started",
  variants: [
    { id: "control", label: "Control", patch: null },
    { id: "cand", label: "Candidate", patch: { type: "hero", heading: "Buy now", subheading: "x", ctaLabel: "Go", ctaHref: "#" } as any },
  ],
  createdBy: "agent",
  minExposuresPerVariant: 200,
});

describe("assignVariant", () => {
  it("is deterministic for the same visitor + experiment", () => {
    const a = assignVariant(exp(), "visitor-42");
    const b = assignVariant(exp(), "visitor-42");
    expect(a.id).toBe(b.id);
  });

  it("distributes roughly evenly across variants", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const v = assignVariant(exp(), `v${i}`);
      counts[v.id] = (counts[v.id] ?? 0) + 1;
    }
    for (const id of ["control", "cand"]) expect(counts[id]).toBeGreaterThan(800);
  });
});

describe("decide", () => {
  const stats = (c: VariantStat, k: VariantStat): VariantStat[] => [c, k];

  it("does NOT decide below the sample gate", () => {
    const r = decide(exp(), stats(
      { variantId: "control", exposures: 50, conversions: 5 },
      { variantId: "cand", exposures: 50, conversions: 25 },
    ));
    expect(r.decided).toBe(false);
    expect(r.reason).toMatch(/sample/i);
  });

  it("decides a clear winner past the gate (z-test p<0.05)", () => {
    const r = decide(exp(), stats(
      { variantId: "control", exposures: 400, conversions: 40 },
      { variantId: "cand", exposures: 400, conversions: 88 },
    ));
    expect(r.decided).toBe(true);
    expect(r.winnerVariantId).toBe("cand");
  });

  it("does NOT decide when arms are statistically tied past the gate", () => {
    const r = decide(exp(), stats(
      { variantId: "control", exposures: 400, conversions: 80 },
      { variantId: "cand", exposures: 400, conversions: 84 },
    ));
    expect(r.decided).toBe(false);
    expect(r.reason).toMatch(/significan/i);
  });

  it("experimentSchema rejects an experiment with <2 variants", () => {
    expect(() => experimentSchema.parse({ ...exp(), variants: [{ id: "x", label: "x", patch: null }] })).toThrow();
  });
});
