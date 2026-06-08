import { describe, it, expect } from "vitest";
import { assertAllowed, checkGuardrail, GovernorError } from "./governor";
import { defaultConstraints, type SiteGoal } from "@shared/site-goal";

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
  it("blocks when the winner rate regresses beyond threshold vs baseline", () => {
    expect(checkGuardrail(0.05, 0.10).ok).toBe(false); // 50% drop
  });
  it("allows when within the regression threshold", () => {
    expect(checkGuardrail(0.09, 0.10).ok).toBe(true); // 10% drop, within 20%
  });
  it("allows when there is no baseline", () => {
    expect(checkGuardrail(0.0, null).ok).toBe(true);
  });
});
