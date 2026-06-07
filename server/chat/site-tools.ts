// Fine-grained, zod-guarded operations on a SiteDocument. Pure: every call
// returns a NEW document (or the same one for reads); the caller owns the
// working copy. Sections are addressed by array index — the schema has no ids.
// (The UI's shared/section-key.ts addresses sections by stable key; the agent
// layer deliberately uses bare indices because the model reads the outline fresh
// each turn.)
import { siteDocumentSchema, sectionSchema, THEME_PRESETS, SECTION_TYPES, type SiteDocument, type Section } from "@shared/site-document";
import type { ToolDef } from "../azure-chat";

export class ToolInputError extends Error {}

export interface ToolOutcome {
  doc: SiteDocument;
  result: unknown; // JSON-serializable payload fed back to the model
  mutated: boolean;
}

function sectionLabel(s: Section): string {
  return ("headline" in s ? s.headline : undefined) ?? ("title" in s ? s.title : undefined) ?? s.type;
}

export function compactOutline(doc: SiteDocument) {
  return {
    meta: doc.meta,
    theme: doc.theme,
    sections: doc.sections.map((s: Section, index: number) => ({
      index, type: s.type, layout: s.layout, label: sectionLabel(s),
    })),
  };
}

function requireIndex(doc: SiteDocument, index: unknown): number {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= doc.sections.length) {
    throw new ToolInputError(`index must be an integer 0..${doc.sections.length - 1} (use read_site to see sections)`);
  }
  return index;
}

// Revalidate the whole document after any mutation; zod failure becomes a
// ToolInputError the model can read and self-correct from.
function validated(doc: unknown): SiteDocument {
  const parsed = siteDocumentSchema.safeParse(doc);
  const path = parsed.error?.issues[0]?.path?.join(".");
  if (!parsed.success) throw new ToolInputError(`change rejected: ${parsed.error.issues[0]?.message ?? "invalid document"}${path ? ` at ${path}` : ""}`);
  return parsed.data;
}

export function applyTool(doc: SiteDocument, name: string, args: any): ToolOutcome {
  switch (name) {
    case "read_site":
      return { doc, result: compactOutline(doc), mutated: false };

    case "read_section": {
      const i = requireIndex(doc, args?.index);
      return { doc, result: doc.sections[i], mutated: false };
    }

    case "edit_section": {
      const i = requireIndex(doc, args?.index);
      if (!args?.patch || typeof args.patch !== "object") throw new ToolInputError("patch must be an object of fields to change");
      const sections = doc.sections.slice();
      sections[i] = { ...(sections[i] as object), ...args.patch } as any;
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, section: next.sections[i] }, mutated: true };
    }

    case "add_section": {
      const parsed = sectionSchema.safeParse(args?.section);
      if (!parsed.success) throw new ToolInputError(`invalid section: ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path?.join(".")}`);
      const after = args?.after === undefined ? doc.sections.length - 1 : requireIndex(doc, args.after);
      const sections = doc.sections.slice();
      sections.splice(after + 1, 0, parsed.data);
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, index: after + 1 }, mutated: true };
    }

    case "remove_section": {
      const i = requireIndex(doc, args?.index);
      const sections = doc.sections.slice();
      sections.splice(i, 1);
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, sections: compactOutline(next).sections }, mutated: true };
    }

    case "move_section": {
      const from = requireIndex(doc, args?.from);
      const to = requireIndex(doc, args?.to);
      const sections = doc.sections.slice();
      const [s] = sections.splice(from, 1);
      sections.splice(to, 0, s);
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, sections: compactOutline(next).sections }, mutated: true };
    }

    case "set_theme": {
      const changed = (args?.preset && args.preset !== doc.theme.preset) || (args?.radius && args.radius !== doc.theme.radius);
      const theme = { ...doc.theme, ...(args?.preset ? { preset: args.preset } : {}), ...(args?.radius ? { radius: args.radius } : {}) };
      const next = validated({ ...doc, theme });
      return { doc: next, result: { ok: true, theme: next.theme, ...(changed ? {} : { note: "no change applied" }) }, mutated: Boolean(changed) };
    }

    case "set_meta": {
      const meta = { ...doc.meta };
      let changed = false;
      for (const k of ["name", "tagline", "industry"] as const) {
        if (typeof args?.[k] === "string" && args[k].trim() && args[k] !== doc.meta[k]) {
          meta[k] = args[k];
          changed = true;
        }
      }
      const next = validated({ ...doc, meta });
      return { doc: next, result: { ok: true, meta: next.meta, ...(changed ? {} : { note: "no change applied" }) }, mutated: changed };
    }

    default:
      throw new ToolInputError(`unknown tool: ${name}`);
  }
}

export const MUTATING_TOOLS = new Set(["edit_section", "add_section", "remove_section", "move_section", "set_theme", "set_meta"]);

const sectionRef = { type: "integer", description: "Section index from read_site" };

export const TOOL_DEFS: ToolDef[] = [
  { type: "function", function: { name: "read_site", description: "Read the compact site outline: meta, theme, and every section's index/type/layout/label. Call this first.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "read_section", description: "Read the full JSON of one section before editing it.", parameters: { type: "object", properties: { index: sectionRef }, required: ["index"] } } },
  { type: "function", function: { name: "edit_section", description: "Merge a partial patch into one section (copy, layout, cta, imageHint...). Read the section first; patch only the fields you change.", parameters: { type: "object", properties: { index: sectionRef, patch: { type: "object", description: "Fields to overwrite on the section" } }, required: ["index", "patch"] } } },
  { type: "function", function: { name: "add_section", description: `Insert a complete new section after the given index (omit 'after' to append at the end). Section types: ${JSON.stringify(SECTION_TYPES)}.`, parameters: { type: "object", properties: { after: sectionRef, section: { type: "object", description: "Complete section object matching the site schema" } }, required: ["section"] } } },
  { type: "function", function: { name: "remove_section", description: "Delete one section by index.", parameters: { type: "object", properties: { index: sectionRef }, required: ["index"] } } },
  { type: "function", function: { name: "move_section", description: "Move a section from one index to another.", parameters: { type: "object", properties: { from: sectionRef, to: sectionRef }, required: ["from", "to"] } } },
  { type: "function", function: { name: "set_theme", description: `Change the visual theme. Presets: ${JSON.stringify(THEME_PRESETS)}. Radius: none|small|medium|large|pill.`, parameters: { type: "object", properties: { preset: { type: "string" }, radius: { type: "string" } } } } },
  { type: "function", function: { name: "set_meta", description: "Change the site name, tagline, or industry.", parameters: { type: "object", properties: { name: { type: "string" }, tagline: { type: "string" }, industry: { type: "string" } } } } },
];
