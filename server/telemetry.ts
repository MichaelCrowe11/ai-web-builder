import { storage } from "./storage";
import { telemetryBatchSchema, type TelemetryEvent, type FunnelReport, type SectionStat, type VariantStat } from "@shared/telemetry";
import type { SiteGoal } from "@shared/site-goal";
import type { SectionType } from "@shared/site-document";

/** Validate + persist a beacon batch. Throws on invalid input (route returns 400). */
export async function ingest(raw: unknown): Promise<number> {
  const events = telemetryBatchSchema.parse(raw) as TelemetryEvent[];
  await storage.insertTelemetry(events);
  return events.length;
}

/** Pure aggregation, extracted for unit testing. */
export function buildFunnel(siteId: string, events: TelemetryEvent[], variantIds: string[]): FunnelReport {
  const sections = new Map<string, SectionStat>();
  const variants = new Map<string, VariantStat>(variantIds.map((id) => [id, { variantId: id, exposures: 0, conversions: 0 }]));

  for (const e of events) {
    if (e.sectionId && (e.type === "section_view" || e.type === "cta_click")) {
      const [, type] = e.sectionId.split(":");
      const s = sections.get(e.sectionId) ?? { key: e.sectionId, type: type as SectionType, views: 0, nextStep: 0 };
      if (e.type === "section_view") s.views++;
      if (e.type === "cta_click") s.nextStep++;
      sections.set(e.sectionId, s);
    }
    if (e.variantId && variants.has(e.variantId)) {
      const v = variants.get(e.variantId)!;
      if (e.type === "section_view") v.exposures++;
      if (e.type === "conversion") v.conversions++;
    }
  }
  return { siteId, sections: Array.from(sections.values()), variants: Array.from(variants.values()) };
}

/** Read path the agent + decision math use. */
export async function funnel(siteId: string, _goal: SiteGoal, variantIds: string[]): Promise<FunnelReport> {
  const events = await storage.recentTelemetry(siteId);
  return buildFunnel(siteId, events, variantIds);
}
