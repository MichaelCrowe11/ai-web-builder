// ============================================================================
// Structured generation: prompt -> validated Site Document.
//
// The AI emits a JSON document conforming to the schema; we validate it with
// zod and (on minor drift) repair it. It never writes markup, so it can't
// produce a broken build. Refine applies a SCOPED instruction to an existing
// document — cheap, fast, and it can't regress unrelated sections because the
// renderer is deterministic.
// ============================================================================
import {
  siteDocumentSchema,
  siteOutlineSchema,
  THEME_PRESETS,
  SECTION_TYPES,
  type SiteDocument,
  type SiteOutline,
} from "@shared/site-document";

import { azureChat, modelsFromEnv, modelsFromEnvForPlan } from "./azure-chat";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

// One Azure chat call returning the assistant text. Resilient: retries 429/408/5xx
// with backoff (honoring Retry-After) and falls back across the model chain
// (AI_WEBBUILDER_MODEL primary, then AI_WEBBUILDER_FALLBACK_MODELS) so a single
// rate-limit blip no longer surfaces as "Failed to generate site".
export async function chat(messages: Array<{ role: string; content: string }>, maxTokens = 3000, plan?: string | null): Promise<string> {
  return azureChat(messages, maxTokens, {
    endpoint: ENDPOINT,
    apiKey: API_KEY,
    apiVersion: API_VERSION,
    models: modelsFromEnvForPlan(plan),
  });
}

// Pull the first JSON object out of a model response.
export function extractJson(text: string): any {
  // Prefer fenced ```json blocks, else the first {...} span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  if (!raw) throw new Error("No JSON object in model response");
  return JSON.parse(raw);
}

export const SCHEMA_GUIDE = `You design websites as a STRUCTURED JSON DOCUMENT (never HTML or code).

Output ONLY a JSON object with this shape:
{
  "version": 1,
  "meta": { "name": string, "tagline": string (short), "industry": string },
  "theme": { "preset": one of ${JSON.stringify(THEME_PRESETS)}, "radius": "none"|"small"|"medium"|"large"|"pill" },
  "sections": [ ... 4 to 7 sections ... ]
}

Each section is one of these shapes (pick the ones that fit the business; ALWAYS start with "hero" and ALWAYS include "contact"). Each section also takes a "layout" that controls its visual arrangement; choose one that suits the content:
- { "type": "hero", "layout": "centered"|"split"|"overlay"|"minimal", "headline": string, "subheadline": string, "cta": { "label": string, "action": "scroll-contact"|"call"|"email" }, "imageHint": string }
- { "type": "services", "layout": "grid"|"list"|"feature", "title": string, "items": [ { "name": string, "description": string } ] }   // 3-6 items, for service businesses
- { "type": "menu", "layout": "single"|"columns"|"grouped", "title": string, "items": [ { "name": string, "price": string, "description": string } ] }  // restaurants/cafes
- { "type": "products", "layout": "grid"|"showcase"|"list", "title": string, "items": [ { "name": string, "price": string, "description": string, "imageHint": string } ] }  // shops
- { "type": "about", "layout": "centered"|"split"|"statement", "title": string, "body": string, "imageHint": string }   // 2-4 sentence story
- { "type": "gallery", "layout": "grid-uniform"|"masonry"|"carousel-strip", "title": string, "imageHints": [ string ] }   // 3-6 short image descriptions
- { "type": "testimonials", "layout": "cards"|"single-spotlight"|"marquee", "title": string, "items": [ { "quote": string, "author": string, "role": string } ] }
- { "type": "contact", "layout": "split"|"stacked"|"card", "title": string, "email": string, "phone": string, "address": string, "hours": string, "showForm": true }
- { "type": "cta", "layout": "band"|"boxed"|"full-bleed", "headline": string, "cta": { "label": string, "action": "call"|"email"|"scroll-contact" } }

Available section types: ${JSON.stringify(SECTION_TYPES)}.
Theme presets: ${JSON.stringify(THEME_PRESETS)}.

Rules:
- Choose a theme preset that fits the brand's mood. Rough guide: trades/auto/fabrication => industrial-slate; wellness/spa/coastal => coastal-calm; florist/garden/plants => botanical-fresh; SaaS/agency/consultancy => tech-precision; bakery/cafe/maker/ceramics => terracotta-warmth; salon/fine-dining/premium => nocturne-luxe or luxe-mono. Otherwise pick whatever fits best.
- VARY the layouts across sections so the page does not feel repetitive. Prefer image-rich layouts (hero "split" or "overlay", about "split", products "showcase") when a photo would strengthen the section.
- Provide a concrete, photographable "imageHint" on hero, about, every product, and gallery entries: a real subject in 2-5 words (e.g. "sourdough loaf on a wooden board", not "food"). No brand names, no text-in-image. Do NOT output any image URLs; the system fills real photos from your hints.
- Write real, specific, warm copy. Never lorem ipsum, never placeholder brackets.
- Invent plausible details (sample menu items, services, a phone like 555-0100) the owner can edit.
- Pick sections that match the business type (a plumber gets services, a cafe gets a menu, a shop gets products).
- Output ONLY the JSON object. No prose, no code fences.`;

// zod's defaults fill missing optional fields; this only needs the model to get
// the required shapes roughly right. We validate and, on failure, retry once
// with the error fed back.
function validate(obj: unknown): SiteDocument {
  return siteDocumentSchema.parse(obj);
}

/** Generate a fresh Site Document from a business description. */
export async function generateDocument(prompt: string, plan?: string | null): Promise<SiteDocument> {
  const messages = [
    { role: "system", content: SCHEMA_GUIDE },
    { role: "user", content: `Design a website for: ${prompt}` },
  ];
  let text = await chat(messages, 3200, plan);
  try {
    return validate(extractJson(text));
  } catch (err: any) {
    // One repair attempt: show the model its mistake.
    const repair = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: `That JSON was invalid (${err.message}). Return ONLY a corrected JSON object matching the schema exactly.` },
    ];
    text = await chat(repair, 3200, plan);
    return validate(extractJson(text));
  }
}

// ---- Two-phase generation (instant skeleton) ----
// Phase 1: a tiny, fast outline so a themed skeleton paints in ~2s.
const OUTLINE_GUIDE = `Design the OUTLINE of a website (a fast first pass). Output ONLY this JSON object:
{
  "meta": { "name": string, "tagline": short string, "industry": string },
  "theme": { "preset": one of ${JSON.stringify(THEME_PRESETS)}, "radius": "none"|"small"|"medium"|"large"|"pill" },
  "sections": [ { "type": one of ${JSON.stringify(SECTION_TYPES)}, "layout": string, "headline": string } ]
}
Rules:
- 5 to 7 sections. ALWAYS start with "hero" and ALWAYS include "contact".
- Choose a theme preset + section types that fit the business (trades->industrial-slate, spa->coastal-calm, florist->botanical-fresh, SaaS->tech-precision, bakery/cafe->terracotta-warmth, salon/fine-dining->nocturne-luxe; otherwise pick what fits).
- Vary section layouts. "headline" is the hero headline or the section title - real and specific, never a placeholder.
- Output ONLY the JSON object. No prose.`;

/** Phase 1: fast outline (name + theme + section sequence with headlines). */
export async function generateOutline(prompt: string, plan?: string | null): Promise<SiteOutline> {
  const messages = [
    { role: "system", content: OUTLINE_GUIDE },
    { role: "user", content: `Outline a website for: ${prompt}` },
  ];
  const text = await chat(messages, 800, plan); // small output keeps this fast
  return siteOutlineSchema.parse(extractJson(text));
}

/** Phase 2: expand an approved outline into the full document, same structure. */
export async function fillDocument(outline: SiteOutline, prompt: string, plan?: string | null): Promise<SiteDocument> {
  const sys = `${SCHEMA_GUIDE}

You are EXPANDING an approved outline into the COMPLETE site document. Keep the SAME meta.name, the SAME theme (preset + radius), and the SAME sequence of sections with the same "type", "layout", and headline/title. Fill in every remaining field: subheadlines, items with real names/prices/descriptions, body copy, imageHints, and contact details. Output ONLY the JSON object.`;
  const messages = [
    { role: "system", content: sys },
    { role: "user", content: `Business: ${prompt}\n\nApproved outline:\n${JSON.stringify(outline)}` },
  ];
  let text = await chat(messages, 3200, plan);
  try {
    return validate(extractJson(text));
  } catch (err: any) {
    const repair = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: `That JSON was invalid (${err.message}). Return ONLY a corrected complete JSON document.` },
    ];
    text = await chat(repair, 3200, plan);
    return validate(extractJson(text));
  }
}

/** Apply a scoped refine instruction to an existing document. Cheap + targeted. */
export async function refineDocument(doc: SiteDocument, instruction: string, plan?: string | null): Promise<SiteDocument> {
  const messages = [
    { role: "system", content: `${SCHEMA_GUIDE}

You are EDITING an existing site document. Apply the user's change and return the COMPLETE updated JSON document. Keep everything else the same; change only what the instruction asks for. Output ONLY the JSON object.` },
    { role: "user", content: `Current document:\n${JSON.stringify(doc)}\n\nChange to make: ${instruction}` },
  ];
  let text = await chat(messages, 3200, plan);
  try {
    return validate(extractJson(text));
  } catch (err: any) {
    const repair = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: `That JSON was invalid (${err.message}). Return ONLY the corrected complete JSON document.` },
    ];
    text = await chat(repair, 3200, plan);
    return validate(extractJson(text));
  }
}

// Suggested refine intents shown as tappable chips in the UI. Each maps to a
// natural-language instruction the model applies as a scoped edit.
export const REFINE_INTENTS: Array<{ label: string; instruction: string }> = [
  { label: "Make it warmer", instruction: "Make the tone warmer and more inviting; soften the copy and consider a warmer theme preset." },
  { label: "More upscale", instruction: "Make it feel more premium and upscale — refined copy and a more luxe theme preset." },
  { label: "Add a booking section", instruction: "Add a clear call-to-action section encouraging visitors to book or get in touch." },
  { label: "Add testimonials", instruction: "Add a testimonials section with 2-3 short, believable customer quotes." },
  { label: "Punchier headline", instruction: "Rewrite the hero headline to be punchier and more memorable." },
  { label: "Bolder look", instruction: "Switch to a bolder, higher-contrast theme preset." },
];

// The primary model in the fallback chain (for logging/labels).
export const MODEL = modelsFromEnv()[0];
