import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "./storage";
import { runGrowthCycle, evaluateAndMaybePromote, type ChatFn } from "./growth-agent";
import { assignVariant } from "@shared/experiment";
import { siteGoalSchema } from "@shared/site-goal";
import type { SiteDocument } from "@shared/site-document";
import type { TelemetryEvent } from "@shared/telemetry";

const doc: SiteDocument = {
  version: 1, meta: { name: "Acme Plumbing" }, theme: { preset: "minimal", radius: "medium" } as any,
  sections: [{ type: "hero", headline: "We do plumbing", subheadline: "x", cta: { label: "Call", action: "call" } } as any],
};

const mockChat: ChatFn = async () => JSON.stringify({
  type: "hero", headline: "Emergency plumber, 60-minute arrival", subheadline: "Licensed & insured", cta: { label: "Book now", action: "scroll-contact" },
});

describe("living sites — full loop", () => {
  let projectId: string;

  beforeAll(async () => {
    const user = await storage.createUser({ username: `loop_${Date.now()}`, password: "x" } as any);
    const p = await storage.createProject({ userId: user.id, html: "", css: "" } as any);
    projectId = p.id;
    await storage.saveDocumentVersion(projectId, doc);
    await storage.setGoal(projectId, siteGoalSchema.parse({
      objective: "book_call", conversionEvent: "call_booked",
      constraints: { lockedSectionIds: [], autonomy: "auto", minExposuresPerVariant: 50 },
    }));
    const seed: TelemetryEvent[] = [];
    for (let i = 0; i < 40; i++) seed.push({ siteId: projectId, visitorId: `seed${i}`, sessionId: "s", ts: Date.now(), type: "section_view", sectionId: "0:hero" });
    await storage.insertTelemetry(seed);
  });

  it("launches an experiment, measures, decides a winner, and promotes a new version", async () => {
    const launch = await runGrowthCycle(projectId, { chat: mockChat, randomId: () => "exp-loop-1" });
    expect(launch.launched).toBe(true);

    const exp = await storage.getRunningExperiment(projectId);
    expect(exp).toBeTruthy();

    const events: TelemetryEvent[] = [];
    for (let i = 0; i < 200; i++) {
      const v = assignVariant(exp!, `real${i}`);
      events.push({ siteId: projectId, visitorId: `real${i}`, sessionId: "s", ts: Date.now(), type: "section_view", sectionId: "0:hero", experimentId: exp!.id, variantId: v.id });
      const convert = v.id === "cand" ? i % 10 < 3 : i % 25 < 2; // ~30% vs ~8%
      if (convert) events.push({ siteId: projectId, visitorId: `real${i}`, sessionId: "s", ts: Date.now(), type: "conversion", sectionId: "0:hero", experimentId: exp!.id, variantId: v.id });
    }
    await storage.insertTelemetry(events);

    const result = await evaluateAndMaybePromote(projectId);
    expect(result.promoted).toBe(true);

    const latest = await storage.getLatestDocument(projectId);
    expect((latest!.document.sections[0] as any).headline).toMatch(/emergency/i);
    expect(latest!.version).toBeGreaterThan(1);

    const decisions = await storage.listDecisions(projectId, 10);
    expect(decisions.some((d) => d.kind === "winner_promoted")).toBe(true);
  });
});
