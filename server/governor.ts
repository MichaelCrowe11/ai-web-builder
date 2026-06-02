import { storage } from "./storage";
import type { SiteGoal } from "@shared/site-goal";
import type { Experiment } from "@shared/experiment";

export class GovernorError extends Error {}

const GUARDRAIL_MAX_REGRESSION = 0.2; // 20% drop in next-step engagement blocks auto-promotion

/** Throw if the agent may not touch this section, or an experiment is already running. */
export function assertAllowed(targetSectionId: string, goal: SiteGoal, running: Experiment | null): void {
  if (goal.constraints.lockedSectionIds.includes(targetSectionId)) {
    throw new GovernorError(`section ${targetSectionId} is locked`);
  }
  if (running) {
    throw new GovernorError(`an experiment is already running for this site (${running.id})`);
  }
}

/** Block promotion if the winner's conversion rate regresses beyond the threshold vs the pre-experiment baseline. */
export function checkGuardrail(winnerRate: number, baselineRate: number | null | undefined): { ok: boolean; reason: string } {
  if (baselineRate == null) return { ok: true, reason: "no baseline" };
  if (winnerRate < baselineRate * (1 - GUARDRAIL_MAX_REGRESSION)) {
    return { ok: false, reason: `winner rate ${(winnerRate * 100).toFixed(1)}% regressed >${GUARDRAIL_MAX_REGRESSION * 100}% below baseline ${(baselineRate * 100).toFixed(1)}%` };
  }
  return { ok: true, reason: `winner rate ${(winnerRate * 100).toFixed(1)}% vs baseline ${(baselineRate * 100).toFixed(1)}%` };
}

/** Append-only audit entry surfaced in Mission Control. */
export async function audit(siteId: string, kind: string, detail: unknown): Promise<void> {
  await storage.appendDecision(siteId, kind, detail);
}
