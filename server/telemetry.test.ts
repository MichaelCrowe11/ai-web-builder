import { describe, it, expect } from "vitest";
import { buildFunnel } from "./telemetry";
import type { TelemetryEvent } from "@shared/telemetry";

const ev = (p: Partial<TelemetryEvent>): TelemetryEvent => ({
  siteId: "s1", visitorId: "v", sessionId: "se", ts: 1, type: "pageview", ...p,
});

describe("buildFunnel", () => {
  it("aggregates per-section views and cta-clicks", () => {
    const events: TelemetryEvent[] = [
      ev({ type: "section_view", sectionId: "0:hero" }),
      ev({ type: "section_view", sectionId: "0:hero" }),
      ev({ type: "cta_click", sectionId: "0:hero" }),
      ev({ type: "section_view", sectionId: "1:cta" }),
    ];
    const r = buildFunnel("s1", events, []);
    const hero = r.sections.find((s) => s.key === "0:hero")!;
    expect(hero.views).toBe(2);
    expect(hero.nextStep).toBe(1);
  });

  it("aggregates per-variant exposures and conversions for the active experiment", () => {
    const events: TelemetryEvent[] = [
      ev({ type: "section_view", experimentId: "e1", variantId: "control" }),
      ev({ type: "section_view", experimentId: "e1", variantId: "control" }),
      ev({ type: "conversion", experimentId: "e1", variantId: "control" }),
      ev({ type: "section_view", experimentId: "e1", variantId: "cand" }),
      ev({ type: "conversion", experimentId: "e1", variantId: "cand" }),
    ];
    const r = buildFunnel("s1", events, ["control", "cand"]);
    const control = r.variants.find((v) => v.variantId === "control")!;
    expect(control.exposures).toBe(2);
    expect(control.conversions).toBe(1);
  });
});
