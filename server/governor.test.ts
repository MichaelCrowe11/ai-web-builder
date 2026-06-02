import { describe, it, expect } from "vitest";
import { assertAllowed, checkGuardrail, GovernorError } from "./governor";
import { defaultConstraints, type SiteGoal } from "@shared/site-goal";
import type { FunnelReport } from "@shared/telemetry";

const goal = (locked: string[]): SiteGoal => ({
  objective: "book_call", conversionEvent: "call_booked",
  constraints: { ...defaultConstraints(), lockedSectionIds: locked },
});

describe("assertAllowed", () => {
  it("rejects a locked section", () => {
    expect(() => assertAllowed("0:hero", goal(["0:hero"]), null)).toThrow(GovernorError);
  });
  it("rejects when an experiment is already running", () => {
    expect(() => assertAllowed("1:cta", goal([]), { id: "e1" } as any)).toThrow(/already running/i);
  });
  it("allows an unlocked section with no active experiment", () => {
    expect(() => assertAllowed("1:cta", goal([]), null)).not.toThrow();
  });
});

describe("checkGuardrail", () => {
  const report = (winnerNextStep: number): FunnelReport => ({
    siteId: "s1",
    sections: [{ key: "0:hero", type: "hero", views: 100, nextStep: winnerNextStep }],
    variants: [],
  });
  it("blocks promotion when engagement regresses beyond threshold", () => {
    const r = checkGuardrail("0:hero", 50, report(30));
    expect(r.ok).toBe(false);
  });
  it("allows promotion when within threshold", () => {
    const r = checkGuardrail("0:hero", 50, report(48));
    expect(r.ok).toBe(true);
  });
});
