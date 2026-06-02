import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "./storage";
import { experimentSchema, type Experiment } from "@shared/experiment";
import type { TelemetryEvent } from "@shared/telemetry";

describe("variantStats counts exposures only on the target section", () => {
  let exp: Experiment;
  beforeAll(async () => {
    exp = experimentSchema.parse({
      id: `vs_${Date.now()}`, siteId: "s1", status: "running", targetSectionId: "0:hero",
      hypothesis: "h", conversionEvent: "c",
      variants: [{ id: "control", label: "C", patch: null }, { id: "cand", label: "K", patch: { type: "hero", headline: "x", cta: { label: "y", action: "call" } } as any }],
      createdBy: "agent", minExposuresPerVariant: 50,
    });
    await storage.insertExperiment(exp);
    const ev = (variantId: string, type: TelemetryEvent["type"], sectionId: string): TelemetryEvent =>
      ({ siteId: "s1", visitorId: "v", sessionId: "s", ts: Date.now(), type, sectionId, experimentId: exp.id, variantId });
    await storage.insertTelemetry([
      ev("cand", "section_view", "0:hero"),   // counts (target)
      ev("cand", "section_view", "2:about"),  // must NOT count (not target)
      ev("cand", "conversion", "0:hero"),     // counts
    ]);
  });
  it("ignores non-target section_views", async () => {
    const stats = await storage.variantStats(exp.id);
    const cand = stats.find((s) => s.variantId === "cand")!;
    expect(cand.exposures).toBe(1);   // only the target-section view
    expect(cand.conversions).toBe(1);
  });
});
