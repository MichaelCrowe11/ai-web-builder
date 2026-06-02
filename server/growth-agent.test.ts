import { describe, it, expect } from "vitest";
import { pickWeakestLink, proposeVariants, type ChatFn } from "./growth-agent";
import { defaultConstraints, type SiteGoal } from "@shared/site-goal";
import type { FunnelReport } from "@shared/telemetry";
import type { Section } from "@shared/site-document";

const goal: SiteGoal = {
  objective: "book_call", conversionEvent: "call_booked",
  constraints: { ...defaultConstraints(), brandVoice: "warm, expert" },
};

describe("pickWeakestLink", () => {
  it("selects the section with the worst view->next-step ratio", () => {
    const report: FunnelReport = {
      siteId: "s1",
      sections: [
        { key: "0:hero", type: "hero", views: 100, nextStep: 8 },
        { key: "1:cta",  type: "cta",  views: 100, nextStep: 40 },
      ],
      variants: [],
    };
    const pick = pickWeakestLink(report, goal);
    expect(pick?.targetSectionId).toBe("0:hero");
    expect(pick?.hypothesis).toMatch(/hero/i);
  });

  it("returns null when no section has enough views", () => {
    const report: FunnelReport = { siteId: "s1", sections: [{ key: "0:hero", type: "hero", views: 3, nextStep: 0 }], variants: [] };
    expect(pickWeakestLink(report, goal)).toBeNull();
  });
});

describe("proposeVariants", () => {
  // REAL hero section shape
  const heroSection: Section = { type: "hero", headline: "We do plumbing", subheadline: "x", cta: { label: "Call", action: "call" } } as any;

  it("returns only schema-valid candidates of the same type", async () => {
    const chat: ChatFn = async () => JSON.stringify({
      type: "hero", headline: "Emergency plumbing in 60 min", subheadline: "Licensed & insured", cta: { label: "Book now", action: "scroll-contact" },
    });
    const out = await proposeVariants(heroSection, goal, "headline too vague", 1, { chat });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("hero");
    expect((out[0] as any).headline).toMatch(/emergency/i);
  });

  it("drops invalid candidates (retry once, then skip)", async () => {
    let calls = 0;
    const chat: ChatFn = async () => { calls++; return "not json at all"; };
    const out = await proposeVariants(heroSection, goal, "h", 1, { chat });
    expect(out).toHaveLength(0);
    expect(calls).toBe(2); // initial + one retry
  });
});
