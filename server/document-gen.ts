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
  THEME_PRESETS,
  SECTION_TYPES,
  type SiteDocument,
} from "@shared/site-document";

import { azureChat, modelsFromEnv } from "./azure-chat";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

// One Azure chat call returning the assistant text. Resilient: retries 429/408/5xx
// with backoff (honoring Retry-After) and falls back across the model chain
// (AI_WEBBUILDER_MODEL primary, then AI_WEBBUILDER_FALLBACK_MODELS) so a single
// rate-limit blip no longer surfaces as "Failed to generate site".
export async function chat(messages: Array<{ role: string; content: string }>, maxTokens = 3000): Promise<string> {
  return azureChat(messages, maxTokens, {
    endpoint: ENDPOINT,
    apiKey: API_KEY,
    apiVersion: API_VERSION,
    models: modelsFromEnv(),
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

const SCHEMA_GUIDE = `You design websites as a STRUCTURED JSON DOCUMENT (never HTML or code).

Output ONLY a JSON object with this shape:
{
  "version": 1,
  "meta": { "name": string, "tagline": string (short), "industry": string },
  "theme": { "preset": one of ${JSON.stringify(THEME_PRESETS)}, "radius": "none"|"small"|"medium"|"large"|"pill" },
  "sections": [ ... 4 to 7 sections ... ]
}

Each section is one of these shapes (pick the ones that fit the business; ALWAYS start with "hero" and ALWAYS include "contact"):
- { "type": "hero", "headline": string, "subheadline": string, "cta": { "label": string, "action": "scroll-contact"|"call"|"email" } }
- { "type": "services", "title": string, "items": [ { "name": string, "description": string } ] }   // 3-6 items, for service businesses
- { "type": "menu", "title": string, "items": [ { "name": string, "price": string, "description": string } ] }  // restaurants/cafes
- { "type": "products", "title": string, "items": [ { "name": string, "price": string, "description": string } ] }  // shops
- { "type": "about", "title": string, "body": string }   // 2-4 sentence story
- { "type": "gallery", "title": string, "imageHints": [ string ] }   // 3-6 short image descriptions
- { "type": "testimonials", "title": string, "items": [ { "quote": string, "author": string, "role": string } ] }
- { "type": "contact", "title": string, "email": string, "phone": string, "address": string, "hours": string, "showForm": true }
- { "type": "cta", "headline": string, "cta": { "label": string, "action": "call"|"email"|"scroll-contact" } }

Available section types: ${JSON.stringify(SECTION_TYPES)}.

Rules:
- Choose a theme preset that fits the brand's mood.
- Write real, specific, warm copy — never lorem ipsum, never placeholder brackets.
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
export async function generateDocument(prompt: string): Promise<SiteDocument> {
  const messages = [
    { role: "system", content: SCHEMA_GUIDE },
    { role: "user", content: `Design a website for: ${prompt}` },
  ];
  let text = await chat(messages, 3200);
  try {
    return validate(extractJson(text));
  } catch (err: any) {
    // One repair attempt: show the model its mistake.
    const repair = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: `That JSON was invalid (${err.message}). Return ONLY a corrected JSON object matching the schema exactly.` },
    ];
    text = await chat(repair, 3200);
    return validate(extractJson(text));
  }
}

/** Apply a scoped refine instruction to an existing document. Cheap + targeted. */
export async function refineDocument(doc: SiteDocument, instruction: string): Promise<SiteDocument> {
  const messages = [
    { role: "system", content: `${SCHEMA_GUIDE}

You are EDITING an existing site document. Apply the user's change and return the COMPLETE updated JSON document. Keep everything else the same; change only what the instruction asks for. Output ONLY the JSON object.` },
    { role: "user", content: `Current document:\n${JSON.stringify(doc)}\n\nChange to make: ${instruction}` },
  ];
  let text = await chat(messages, 3200);
  try {
    return validate(extractJson(text));
  } catch (err: any) {
    const repair = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: `That JSON was invalid (${err.message}). Return ONLY the corrected complete JSON document.` },
    ];
    text = await chat(repair, 3200);
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
