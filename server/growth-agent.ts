import { storage } from "./storage";
import { chat as realChat, extractJson } from "./document-gen";
import { funnel } from "./telemetry";
import { assertAllowed, checkGuardrail, audit } from "./governor";
import { sectionSchema, patchSection, findSectionIndex, type Section, type SiteDocument } from "@shared/site-document";
import { experimentSchema, decide, type Experiment, type Variant } from "@shared/experiment";
import type { SiteGoal } from "@shared/site-goal";
import type { FunnelReport } from "@shared/telemetry";

export type ChatFn = (messages: Array<{ role: string; content: string }>, maxTokens?: number) => Promise<string>;
export interface GrowthDeps { chat?: ChatFn; randomId?: () => string; }

const MIN_VIEWS = 20;

/** Pure: the section with the worst view->next-step ratio (enough traffic to judge). */
export function pickWeakestLink(report: FunnelReport, _goal: SiteGoal): { targetSectionId: string; hypothesis: string } | null {
  const eligible = report.sections.filter((s) => s.views >= MIN_VIEWS);
  if (eligible.length === 0) return null;
  const worst = eligible.reduce((a, b) => (b.nextStep / b.views < a.nextStep / a.views ? b : a));
  const rate = ((worst.nextStep / worst.views) * 100).toFixed(0);
  return {
    targetSectionId: worst.key,
    hypothesis: `The ${worst.type} section gets ${worst.views} views but only ${rate}% click through, so its copy likely under-motivates the next step.`,
  };
}

/** Ask Foundry for N scoped, same-type candidates; keep only sectionSchema-valid ones (retry once). */
export async function proposeVariants(section: Section, goal: SiteGoal, hypothesis: string, n: number, deps: GrowthDeps = {}): Promise<Section[]> {
  const chat = deps.chat ?? realChat;
  const sys = [
    `You optimize ONE website section toward the goal: ${goal.objective} (success = "${goal.conversionEvent}").`,
    goal.constraints.brandVoice ? `Brand voice: ${goal.constraints.brandVoice}.` : "",
    `Hypothesis: ${hypothesis}`,
    `Return ONLY a JSON object for a single section of type "${section.type}", same shape as the input. No markdown, no commentary, no emoji.`,
    `Do not change prices, menu items, or product names.`,
  ].filter(Boolean).join(" ");
  const user = `Current section JSON:\n${JSON.stringify(section)}`;

  const out: Section[] = [];
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await chat([{ role: "system", content: sys }, { role: "user", content: user }], 1200);
      try {
        const cand = sectionSchema.parse(extractJson(text));
        if (cand.type === section.type) { out.push(cand); break; }
      } catch { /* invalid -> retry once, then skip */ }
    }
  }
  return out;
}

/** One autonomous cycle for a site: observe -> propose -> launch one experiment. */
export async function runGrowthCycle(projectId: string, deps: GrowthDeps = {}): Promise<{ launched: boolean; reason: string }> {
  const goal = await storage.getGoal(projectId);
  if (!goal) return { launched: false, reason: "no goal set" };

  const running = await storage.getRunningExperiment(projectId);
  if (running) return { launched: false, reason: "experiment already running" };

  const latest = await storage.getLatestDocument(projectId);
  if (!latest) return { launched: false, reason: "no document" };

  const report = await funnel(projectId, goal, []);
  const pick = pickWeakestLink(report, goal);
  if (!pick) return { launched: false, reason: "insufficient traffic" };

  try {
    assertAllowed(pick.targetSectionId, goal, null);
  } catch (e: any) {
    return { launched: false, reason: e.message };
  }

  const idx = findSectionIndex(latest.document, pick.targetSectionId);
  if (idx === -1) return { launched: false, reason: "target section vanished" };
  const candidates = await proposeVariants(latest.document.sections[idx], goal, pick.hypothesis, 1, deps);
  if (candidates.length === 0) return { launched: false, reason: "no valid candidate" };

  const priorEvents = await storage.recentTelemetry(projectId);
  let baseViews = 0, baseConvs = 0;
  for (const e of priorEvents) {
    if (e.sectionId === pick.targetSectionId) {
      if (e.type === "section_view") baseViews++;
      if (e.type === "conversion") baseConvs++;
    }
  }
  const baselineConversionRate = baseViews > 0 ? baseConvs / baseViews : undefined;

  const newId = (deps.randomId ?? cryptoId)();
  const exp: Experiment = experimentSchema.parse({
    id: newId, siteId: projectId, status: goal.constraints.autonomy === "auto" ? "running" : "proposed",
    targetSectionId: pick.targetSectionId, hypothesis: pick.hypothesis, conversionEvent: goal.conversionEvent,
    variants: [
      { id: "control", label: "Control", patch: null },
      { id: "cand", label: "Candidate", patch: candidates[0] },
    ] satisfies Variant[],
    createdBy: "agent", minExposuresPerVariant: goal.constraints.minExposuresPerVariant,
    baselineConversionRate,
  });
  await storage.insertExperiment(exp);
  await audit(projectId, "experiment_launched", { id: exp.id, status: exp.status, targetSectionId: exp.targetSectionId, hypothesis: exp.hypothesis });
  return { launched: true, reason: exp.status === "running" ? "running" : "awaiting owner approval" };
}

/** Evaluate the running experiment; promote the winner into a new document version if the guardrail passes. */
export async function evaluateAndMaybePromote(projectId: string): Promise<{ promoted: boolean; reason: string }> {
  const exp = await storage.getRunningExperiment(projectId);
  if (!exp) return { promoted: false, reason: "no running experiment" };

  const stats = await storage.variantStats(exp.id);
  const result = decide(exp, stats);
  if (!result.decided) return { promoted: false, reason: result.reason };

  const winner = exp.variants.find((v) => v.id === result.winnerVariantId)!;
  await storage.updateExperiment(exp.id, { status: "concluded", winnerVariantId: winner.id });

  if (!winner.patch) {
    await audit(projectId, "experiment_concluded", { id: exp.id, winner: winner.id, note: "control won, no change" });
    return { promoted: false, reason: "control won" };
  }

  const winnerStat = stats.find((s) => s.variantId === winner.id);
  const winnerRate = winnerStat && winnerStat.exposures > 0 ? winnerStat.conversions / winnerStat.exposures : 0;
  const guard = checkGuardrail(winnerRate, exp.baselineConversionRate ?? null);
  if (!guard.ok) {
    await audit(projectId, "promotion_blocked", { id: exp.id, reason: guard.reason });
    return { promoted: false, reason: guard.reason };
  }

  const latest = await storage.getLatestDocument(projectId);
  if (!latest) return { promoted: false, reason: "no document" };
  const next: SiteDocument = patchSection(latest.document, exp.targetSectionId, winner.patch);
  const { version } = await storage.saveDocumentVersion(projectId, next);
  await audit(projectId, "winner_promoted", { id: exp.id, winner: winner.id, version, reason: result.reason });
  return { promoted: true, reason: `promoted to v${version}` };
}

function cryptoId(): string {
  return "xxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}
