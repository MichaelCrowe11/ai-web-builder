import { z } from "zod";
import type { SectionType } from "./site-document";

export const telemetryEventTypeEnum = z.enum([
  "pageview", "section_view", "cta_click", "scroll_depth", "conversion",
]);
export type TelemetryEventType = z.infer<typeof telemetryEventTypeEnum>;

export const telemetryEventSchema = z.object({
  siteId: z.string().min(1),
  visitorId: z.string().min(1),
  sessionId: z.string().min(1),
  ts: z.number().int(),
  type: telemetryEventTypeEnum,
  sectionId: z.string().optional(),     // a section key, e.g. "0:hero"
  experimentId: z.string().optional(),
  variantId: z.string().optional(),
  meta: z.record(z.union([z.string(), z.number()])).optional(),
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** A single beacon POST carries 1..50 events. */
export const telemetryBatchSchema = z.array(telemetryEventSchema).min(1).max(50);

/** Per-section funnel stat (engagement toward the next step). */
export interface SectionStat {
  key: string;          // section key
  type: SectionType;
  views: number;        // section_view count
  nextStep: number;     // cta_click count attributed to this section
}

/** Per-variant outcome for the active experiment. */
export interface VariantStat {
  variantId: string;
  exposures: number;    // section_view of the experiment's target, tagged with this variant
  conversions: number;  // conversion events tagged with this variant
}

export interface FunnelReport {
  siteId: string;
  sections: SectionStat[];
  variants: VariantStat[]; // empty when no active experiment
}
