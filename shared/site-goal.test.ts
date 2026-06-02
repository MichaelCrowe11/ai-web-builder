import { describe, it, expect } from "vitest";
import { siteGoalSchema, defaultConstraints, type SiteGoal } from "@shared/site-goal";

describe("siteGoalSchema", () => {
  it("accepts a minimal valid goal and applies constraint defaults", () => {
    const g = siteGoalSchema.parse({
      objective: "sell_product",
      conversionEvent: "checkout_started",
      constraints: { lockedSectionIds: [] },
    });
    expect(g.constraints.autonomy).toBe("suggest");
    expect(g.constraints.minExposuresPerVariant).toBe(200);
    expect(g.constraints.lockedCopy).toBe(true);
  });

  it("rejects an unknown objective", () => {
    expect(() =>
      siteGoalSchema.parse({ objective: "go_viral", conversionEvent: "x", constraints: { lockedSectionIds: [] } }),
    ).toThrow();
  });

  it("defaultConstraints is a complete constraint object", () => {
    expect(defaultConstraints()).toMatchObject({ autonomy: "suggest", lockedCopy: true, minExposuresPerVariant: 200, lockedSectionIds: [] });
  });
});
