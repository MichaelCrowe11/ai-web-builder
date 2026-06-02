import { z } from "zod";
import { sectionSchema } from "./site-document";
import type { VariantStat } from "./telemetry";

export const experimentStatusEnum = z.enum(["proposed", "running", "concluded", "rejected"]);
export type ExperimentStatus = z.infer<typeof experimentStatusEnum>;

export const variantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  patch: sectionSchema.nullable(), // null = control (the canonical section)
});
export type Variant = z.infer<typeof variantSchema>;

export const experimentSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  status: experimentStatusEnum,
  targetSectionId: z.string().min(1),  // a section key
  hypothesis: z.string(),
  conversionEvent: z.string().min(1),
  variants: z.array(variantSchema).min(2),
  createdBy: z.enum(["agent", "owner"]),
  minExposuresPerVariant: z.number().int().positive(),
  winnerVariantId: z.string().optional(),
});
export type Experiment = z.infer<typeof experimentSchema>;

/** Deterministic FNV-1a hash → stable variant for a visitor. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function assignVariant(exp: Experiment, visitorId: string): Variant {
  const idx = hash(`${visitorId}:${exp.id}`) % exp.variants.length;
  return exp.variants[idx];
}

export interface DecideResult {
  decided: boolean;
  winnerVariantId?: string;
  reason: string;
}

/** Two-proportion z-test against the runner-up; gated on min exposures. */
export function decide(exp: Experiment, stats: VariantStat[]): DecideResult {
  const byId = new Map(stats.map((s) => [s.variantId, s]));
  for (const v of exp.variants) {
    const s = byId.get(v.id);
    if (!s || s.exposures < exp.minExposuresPerVariant) {
      return { decided: false, reason: `sample gate: ${v.id} has ${s?.exposures ?? 0}/${exp.minExposuresPerVariant} exposures` };
    }
  }
  const rate = (s: VariantStat) => s.conversions / s.exposures;
  const ranked = [...stats].sort((a, b) => rate(b) - rate(a));
  const leader = ranked[0];
  const runner = ranked[1];

  const p1 = rate(leader), p2 = rate(runner);
  const pPool = (leader.conversions + runner.conversions) / (leader.exposures + runner.exposures);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / leader.exposures + 1 / runner.exposures));
  const z = se === 0 ? 0 : (p1 - p2) / se;

  if (Math.abs(z) < 1.96) {
    return { decided: false, reason: `not significant (z=${z.toFixed(2)}, need |z|>1.96)` };
  }
  return { decided: true, winnerVariantId: leader.variantId, reason: `winner ${leader.variantId} at z=${z.toFixed(2)}` };
}
