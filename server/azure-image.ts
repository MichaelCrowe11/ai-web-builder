// ============================================================================
// Generated photography via Azure (gpt-image-2 on the existing foundry
// resource). Topical and bespoke per imageHint, so no stock-photo licensing and
// no other site on the internet has the same picture.
//
// Measured on this deployment: about 50 seconds and roughly 650KB of base64 per
// image, at one concurrent call. That shape dictates everything below. It runs
// ASYNC, after the text site is already on screen, and it is best-effort: a
// failure returns null and the renderer falls back to its gradient, because a
// site with a gradient beats a site that will not load.
//
// It is NOT Pro-only any more. It was, and the result was that every build a
// prospective customer ever saw shipped grey rectangles. See ./image-budget.
// ============================================================================
import type { SiteDocument } from "@shared/site-document";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const MODEL = process.env.AI_WEBBUILDER_IMAGE_MODEL ?? "gpt-image-1";
const API_VERSION = process.env.AZURE_IMAGE_API_VERSION ?? "2025-04-01-preview";

export function imagesEnabled(): boolean {
  return !!(ENDPOINT && API_KEY);
}

// The image deployment takes ONE call at a time.
//
// Measured, not assumed: three concurrent requests to gpt-image-2 on this
// resource returned three 429 RateLimitReached with Retry-After: 2. The old
// code fired every image in parallel and returned null on any non-200, so a
// three-image document reliably produced one image and two gradients, silently.
// That is why generated sites looked like they had no photography: they asked
// for it and threw the refusals away.
//
// So calls are queued through here at concurrency 1 and retried on 429/5xx.
// Latency is already off the critical path (the site renders first), which is
// what makes serialising affordable.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  // Keep the chain alive after a rejection, otherwise one failure wedges it.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function waitMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 15_000);
  return Math.min(1000 * 2 ** attempt, 15_000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Generate one image for a hint. Returns a JPEG data URI, or null on any failure. */
export async function generateSiteImage(
  hint: string,
  orientation: "landscape" | "portrait" = "landscape",
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!imagesEnabled() || !hint.trim()) return null;
  const size = orientation === "portrait" ? "1024x1536" : "1536x1024";
  const prompt = `${hint}. Professional editorial website photography, natural light, high detail. No text, no words, no watermark, no logo.`;
  const url = `${ENDPOINT.replace(/\/$/, "")}/openai/deployments/${MODEL}/images/generations?api-version=${API_VERSION}`;
  const body = JSON.stringify({ prompt, n: 1, size, quality: "medium", output_format: "jpeg" });

  return serialize(async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": API_KEY },
          body,
        });
        if (res.ok) {
          const data = await res.json();
          const b64 = data?.data?.[0]?.b64_json;
          return b64 ? `data:image/jpeg;base64,${b64}` : null;
        }
        if (!RETRYABLE.has(res.status) || attempt === MAX_ATTEMPTS - 1) return null;
        await sleep(waitMs(res, attempt));
      } catch {
        if (attempt === MAX_ATTEMPTS - 1) return null;
        await sleep(Math.min(1000 * 2 ** attempt, 15_000));
      }
    }
    return null;
  });
}

// Which sections are worth an image, most valuable first. The hero is not
// negotiable: it is the one a visitor decides on, and a grey rectangle there is
// what makes a generated site look generated.
const IMAGE_SECTIONS = ["hero", "about", "products", "gallery"] as const;

function rank(type: string): number {
  const i = (IMAGE_SECTIONS as readonly string[]).indexOf(type);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Add generated images to a document, best-effort. Returns a NEW document;
 * sections that fail keep their gradient.
 *
 * `limit` bounds cost and latency, and is the whole reason this is not simply
 * "every section": one image is a measured ~50s and several hundred KB inline,
 * so the free tier gets the hero and Pro gets the sections after it. Candidates
 * are ranked rather than taken in document order, because a document whose
 * gallery precedes its hero would otherwise spend the one image it gets on the
 * gallery.
 *
 * Runs in parallel, so wall-clock is one image, not `limit` images.
 */
export async function addGeneratedImages(
  doc: SiteDocument,
  limit = 2,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteDocument> {
  if (!imagesEnabled() || limit < 1) return doc;

  const candidates = doc.sections
    .map((s, i) => ({ i, type: s.type, hint: (s as any).imageHint, has: !!(s as any).image }))
    .filter((c) => c.hint && !c.has && rank(c.type) !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => rank(a.type) - rank(b.type))
    .slice(0, limit);

  if (!candidates.length) return doc;

  const results = await Promise.all(
    candidates.map(async (c) => ({
      i: c.i,
      url: await generateSiteImage(c.hint, "landscape", fetchImpl),
      hint: c.hint,
    })),
  );

  const byIndex = new Map(results.filter((r) => r.url).map((r) => [r.i, r]));
  if (!byIndex.size) return doc;

  const sections = doc.sections.map((s, i) => {
    const hit = byIndex.get(i);
    return hit ? ({ ...s, image: { url: hit.url!, alt: hit.hint } } as typeof s) : s;
  });
  return { ...doc, sections } as SiteDocument;
}
