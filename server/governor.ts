import { storage } from "./storage";
import type { SiteGoal } from "@shared/site-goal";
import type { Experiment } from "@shared/experiment";
import type { FunnelReport } from "@shared/telemetry";

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

/** Guardrail: block promotion if the winner regresses engagement beyond the threshold. */
export function checkGuardrail(targetSectionId: string, baselineNextStep: number, report: FunnelReport): { ok: boolean; reason: string } {
  const sec = report.sections.find((s) => s.key === targetSectionId);
  const after = sec?.nextStep ?? 0;
  if (baselineNextStep === 0) return { ok: true, reason: "no baseline" };
  const delta = (after - baselineNextStep) / baselineNextStep;
  if (delta < -GUARDRAIL_MAX_REGRESSION) {
    return { ok: false, reason: `engagement regressed ${(delta * 100).toFixed(0)}% (threshold -${GUARDRAIL_MAX_REGRESSION * 100}%)` };
  }
  return { ok: true, reason: `engagement delta ${(delta * 100).toFixed(0)}%` };
}

/** Append-only audit entry surfaced in Mission Control. */
export async function audit(siteId: string, kind: string, detail: unknown): Promise<void> {
  await storage.appendDecision(siteId, kind, detail);
}
