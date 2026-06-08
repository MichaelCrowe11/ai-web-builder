// ============================================================================
// Structured generation: prompt -> validated Site Document.
//
// Efficiency model (why this feels fast, Replit-style):
//   • TWO-PHASE generate: a cheap OUTLINE call (structure only) renders a themed
//     skeleton instantly, then a FILL call writes the copy.
//   • SCOPED refine: copy edits send/return only ONE section, not the whole doc.
//   • Theme tweaks never touch this file — the client recomputes CSS locally.
//   • A small in-memory CACHE returns identical prompts without hitting Azure.
//
// The AI only ever emits JSON conforming to the schema; a trusted renderer makes
// the markup, so output can't be a broken build or a security hole.
// ============================================================================
import {
  siteDocumentSchema,
  siteOutlineSchema,
  sectionSchema,
  THEME_PRESETS,
  SECTION_TYPES,
  type SiteDocument,
  type SiteOutlineDoc,
  type Section,
  type SectionType,
  type ThemePreset,
} from "@shared/site-document";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const DEPLOYMENT = process.env.AI_WEBBUILDER_MODEL ?? "grok-4-1-fast-non-r";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";
const IS_GPT5 = /^gpt-5/i.test(DEPLOYMENT);

function chatUrl(): string {
  if (!ENDPOINT || !API_KEY) {
    throw new Error("Azure Foundry not configured: set AZURE_CORE_ENDPOINT and AZURE_CORE_API_KEY");
  }
  return `${ENDPOINT.replace(/\/$/, "")}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
}

// One Azure chat call returning the assistant text.
async function chat(messages: Array<{ role: string; content: string }>, maxTokens = 3000): Promise<string> {
  const body: Record<string, unknown> = { messages };
  body[IS_GPT5 ? "max_completion_tokens" : "max_tokens"] = maxTokens;
  if (!IS_GPT5) body.temperature = 0.6;

  const res = await fetch(chatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Azure ${DEPLOYMENT} returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Pull the first JSON object out of a model response.
function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/)?.[0] ?? "");
  if (!raw) throw new Error("No JSON object in model response");
  return JSON.parse(raw);
}

// Run a chat that must return JSON validated by `validate`, with one repair
// attempt that shows the model its own mistake.
async function chatValidated<T>(
  messages: Array<{ role: string; content: string }>,
  validate: (obj: unknown) => T,
  maxTokens: number,
): Promise<T> {
  let text = await chat(messages, maxTokens);
  try {
    return validate(extractJson(text));
  } catch (err: any) {
    const repair = [
      ...messages,
      { role: "assistant", content: text },
      { role: "user", content: `That JSON was invalid (${err.message}). Return ONLY a corrected JSON object matching the schema exactly.` },
    ];
    text = await chat(repair, maxTokens);
    return validate(extractJson(text));
  }
}

// ---- Prompt cache (in-memory LRU + TTL) ----
// Identical prompts skip Azure entirely. Bounded so it can't grow unbounded;
// TTL keeps it fresh. (Process-local — a warm instance is what makes this pay
// off, so keep the Railway service from scaling to zero for this flow.)
const CACHE_MAX = 200;
const CACHE_TTL_MS = 1000 * 60 * 30;
const cache = new Map<string, { at: number; value: unknown }>();

function cacheKey(kind: string, prompt: string): string {
  return `${kind}:${prompt.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
function cacheGet<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e) return null;
  if (nowMs() - e.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh LRU recency.
  cache.delete(key);
  cache.set(key, e);
  return e.value as T;
}
function cacheSet(key: string, value: unknown): void {
  cache.delete(key);
  cache.set(key, { at: nowMs(), value });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
function nowMs(): number {
  return new Date().getTime();
}

// ---- Shared schema guidance ----
const SECTION_MENU = `Each section is one of these shapes (pick the ones that fit the business; ALWAYS start with "hero" and ALWAYS include "contact"):
- { "type": "hero", "headline": string, "subheadline": string, "cta": { "label": string, "action": "scroll-contact"|"call"|"email" } }
- { "type": "services", "title": string, "items": [ { "name": string, "description": string } ] }   // 3-6 items
- { "type": "menu", "title": string, "items": [ { "name": string, "price": string, "description": string } ] }  // restaurants/cafes
- { "type": "products", "title": string, "items": [ { "name": string, "price": string, "description": string } ] }  // shops
- { "type": "about", "title": string, "body": string }   // 2-4 sentence story
- { "type": "gallery", "title": string, "imageHints": [ string ] }   // 3-6 short image descriptions
- { "type": "testimonials", "title": string, "items": [ { "quote": string, "author": string, "role": string } ] }
- { "type": "contact", "title": string, "email": string, "phone": string, "address": string, "hours": string, "showForm": true }
- { "type": "cta", "headline": string, "cta": { "label": string, "action": "call"|"email"|"scroll-contact" } }`;

const COPY_RULES = `Write real, specific, warm copy — never lorem ipsum, never placeholder brackets. Invent plausible details (sample menu items, services, a phone like 555-0100) the owner can edit. Pick a theme preset that fits the brand's mood.`;

const SCHEMA_GUIDE = `You design websites as a STRUCTURED JSON DOCUMENT (never HTML or code).

Output ONLY a JSON object with this shape:
{
  "version": 1,
  "meta": { "name": string, "tagline": string (short), "industry": string },
  "theme": { "preset": one of ${JSON.stringify(THEME_PRESETS)}, "radius": "none"|"small"|"medium"|"large"|"pill" },
  "sections": [ ... 4 to 7 sections ... ]
}

${SECTION_MENU}

Available section types: ${JSON.stringify(SECTION_TYPES)}.

Rules:
- ${COPY_RULES}
- Pick sections that match the business type (a plumber gets services, a cafe gets a menu, a shop gets products).
- Output ONLY the JSON object. No prose, no code fences.`;

// ---- Validators ----
function validateDoc(obj: unknown): SiteDocument {
  return siteDocumentSchema.parse(obj);
}
function validateOutline(obj: unknown): SiteOutlineDoc {
  return siteOutlineSchema.parse(obj);
}
function validateSection(obj: unknown): Section {
  return sectionSchema.parse(obj);
}

// ============================================================================
// Single-shot generation (legacy / fallback path kept for /api/generate/document)
// ============================================================================
export async function generateDocument(prompt: string): Promise<SiteDocument> {
  const key = cacheKey("doc", prompt);
  const hit = cacheGet<SiteDocument>(key);
  if (hit) return hit;

  const messages = [
    { role: "system", content: SCHEMA_GUIDE },
    { role: "user", content: `Design a website for: ${prompt}` },
  ];
  const doc = await chatValidated(messages, validateDoc, 3200);
  cacheSet(key, doc);
  return doc;
}

// ============================================================================
// PHASE 1 — Outline only (structure + theme, no body copy). Cheap and fast, so
// the client can paint a themed skeleton almost immediately.
// ============================================================================
export async function generateOutline(prompt: string): Promise<SiteOutlineDoc> {
  const key = cacheKey("outline", prompt);
  const hit = cacheGet<SiteOutlineDoc>(key);
  if (hit) return hit;

  const messages = [
    {
      role: "system",
      content: `You plan a website's STRUCTURE only — no body copy yet.

Output ONLY this JSON:
{
  "meta": { "name": string, "tagline": short string, "industry": string },
  "theme": { "preset": one of ${JSON.stringify(THEME_PRESETS)}, "radius": "none"|"small"|"medium"|"large"|"pill" },
  "outline": [ { "type": one of ${JSON.stringify(SECTION_TYPES)}, "title": short section heading } ]
}

Rules:
- 4 to 7 sections. ALWAYS start with "hero" and ALWAYS end with (or include) "contact".
- Choose section types that fit the business (cafe -> menu, shop -> products, service -> services).
- Pick a theme preset that fits the brand's mood.
- Titles are short headings only — no paragraphs. Output ONLY the JSON.`,
    },
    { role: "user", content: `Plan a website for: ${prompt}` },
  ];
  const outline = await chatValidated(messages, validateOutline, 900);
  cacheSet(key, outline);
  return outline;
}

// ============================================================================
// PHASE 2 — Fill an approved outline with real section copy -> full document.
// ============================================================================
export async function fillDocument(outline: SiteOutlineDoc, prompt: string): Promise<SiteDocument> {
  const messages = [
    {
      role: "system",
      content: `You write the COPY for a website whose structure is already decided.

${SECTION_MENU}

Return ONLY a full JSON document:
{ "version": 1, "meta": {...}, "theme": {...}, "sections": [ ... ] }

Rules:
- Keep the EXACT section order, types, theme, and meta from the approved outline below.
- Use each outline title as that section's title/headline.
- ${COPY_RULES}
- Output ONLY the JSON object.`,
    },
    {
      role: "user",
      content: `Business brief: ${prompt}\n\nApproved outline (keep this structure exactly):\n${JSON.stringify(outline)}`,
    },
  ];
  return chatValidated(messages, validateDoc, 3200);
}

// ============================================================================
// SCOPED refine — operate on ONE section instead of regenerating the whole doc.
// ============================================================================

// Compact per-type shape hints so the model returns a valid single section.
const SECTION_HINTS: Record<SectionType, string> = {
  hero: `{ "type":"hero","headline":string,"subheadline":string,"cta":{"label":string,"action":"scroll-contact"|"call"|"email"} }`,
  services: `{ "type":"services","title":string,"items":[{"name":string,"description":string}] } (3-6 items)`,
  menu: `{ "type":"menu","title":string,"items":[{"name":string,"price":string,"description":string}] }`,
  products: `{ "type":"products","title":string,"items":[{"name":string,"price":string,"description":string}] }`,
  about: `{ "type":"about","title":string,"body":string }`,
  gallery: `{ "type":"gallery","title":string,"imageHints":[string] } (3-6 hints)`,
  testimonials: `{ "type":"testimonials","title":string,"items":[{"quote":string,"author":string,"role":string}] } (2-3)`,
  contact: `{ "type":"contact","title":string,"email":string,"phone":string,"address":string,"hours":string,"showForm":true }`,
  cta: `{ "type":"cta","headline":string,"cta":{"label":string,"action":"call"|"email"|"scroll-contact"} }`,
};

function industryNote(doc: SiteDocument): string {
  return doc.meta.industry ? ` (industry: ${doc.meta.industry})` : "";
}

/** Edit the first section of `targetType`. Sends only that section to the model. */
export async function editSection(
  doc: SiteDocument,
  targetType: SectionType,
  instruction: string,
): Promise<SiteDocument> {
  const index = doc.sections.findIndex((s) => s.type === targetType);
  if (index === -1) {
    // Nothing to edit — fall back to adding one of that type.
    return addSection(doc, targetType, instruction);
  }
  const section = doc.sections[index];
  const messages = [
    {
      role: "system",
      content: `You edit ONE section of a website. Business: ${doc.meta.name}${industryNote(doc)}.
Return ONLY the updated section as a JSON object of the SAME type ("${section.type}").
Shape: ${SECTION_HINTS[section.type]}
Keep "type" as "${section.type}". ${COPY_RULES} Output ONLY the JSON object.`,
    },
    { role: "user", content: `Current section:\n${JSON.stringify(section)}\n\nChange to make: ${instruction}` },
  ];
  const updated = await chatValidated(messages, validateSection, 1200);
  // Guard against type drift from the model.
  if (updated.type !== section.type) return doc;
  const sections = [...doc.sections];
  sections[index] = updated;
  return { ...doc, sections };
}

/** Generate a single new section of `type` and insert it (before contact). */
export async function addSection(
  doc: SiteDocument,
  type: SectionType,
  instruction: string,
): Promise<SiteDocument> {
  if (doc.sections.length >= 10) return doc; // schema cap
  const messages = [
    {
      role: "system",
      content: `You write ONE new section for an existing website. Business: ${doc.meta.name}${industryNote(doc)}.
Return ONLY a JSON object of type "${type}".
Shape: ${SECTION_HINTS[type]}
Set "type" to "${type}". ${COPY_RULES} Output ONLY the JSON object.`,
    },
    { role: "user", content: `Add this: ${instruction}\n\nExisting sections (for tone/consistency): ${doc.sections.map((s) => s.type).join(", ")}` },
  ];
  const section = await chatValidated(messages, validateSection, 1200);
  if (section.type !== type) return doc;
  // Insert before the contact section if present, else append.
  const contactIdx = doc.sections.findIndex((s) => s.type === "contact");
  const sections = [...doc.sections];
  if (contactIdx === -1) sections.push(section);
  else sections.splice(contactIdx, 0, section);
  return { ...doc, sections };
}

// ============================================================================
// Refine intents shown as chips. Three kinds:
//   theme — applied INSTANTLY on the client (no AI, no network)
//   copy  — scoped edit of one existing section type
//   add   — generate one new section
// ============================================================================
export type RefineIntent =
  | { id: string; label: string; kind: "theme"; preset: ThemePreset }
  | { id: string; label: string; kind: "copy"; scope: SectionType; instruction: string }
  | { id: string; label: string; kind: "add"; section: SectionType; instruction: string };

export const REFINE_INTENTS: RefineIntent[] = [
  // Instant — local theme swaps (the most-tapped chips become zero-latency).
  { id: "warmer", label: "Warmer", kind: "theme", preset: "warm-editorial" },
  { id: "upscale", label: "More upscale", kind: "theme", preset: "luxe-mono" },
  { id: "bolder", label: "Bolder look", kind: "theme", preset: "bold-dark" },
  { id: "cleaner", label: "Cleaner", kind: "theme", preset: "modern-minimal" },
  // Scoped copy edits (one section only).
  { id: "punchy-headline", label: "Punchier headline", kind: "copy", scope: "hero",
    instruction: "Rewrite the hero headline (and subheadline if present) to be punchier and more memorable. Keep it honest to the business." },
  // Structural additions (one new section).
  { id: "add-testimonials", label: "Add testimonials", kind: "add", section: "testimonials",
    instruction: "Add a testimonials section with 2-3 short, believable customer quotes." },
  { id: "add-booking", label: "Add a booking CTA", kind: "add", section: "cta",
    instruction: "Add a clear call-to-action section encouraging visitors to book or get in touch." },
];

export const MODEL = DEPLOYMENT;
