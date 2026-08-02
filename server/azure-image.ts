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

export type Orientation = "landscape" | "portrait" | "square";

// Shape follows the slot, and so does weight. A hero is a full-bleed banner and
// earns the wide frame; a product cell or a gallery tile renders a few hundred
// pixels across, so asking for a 1536-wide banner there buys nothing and costs
// the same. These are inlined as base64 into the document, so every kilobyte is
// carried by the published page.
const SIZES: Record<Orientation, string> = {
  landscape: "1536x1024",
  portrait: "1024x1536",
  square: "1024x1024",
};

/** Generate one image for a hint. Returns a JPEG data URI, or null on any failure. */
export async function generateSiteImage(
  hint: string,
  orientation: Orientation = "landscape",
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!imagesEnabled() || !hint.trim()) return null;
  const size = SIZES[orientation] ?? SIZES.landscape;
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

// An image SLOT: somewhere in the document a picture can go. Slots are not
// sections. A products section holds one hint per item, and a gallery holds an
// array of hints with an index-aligned array of results, so a section-level
// lookup finds neither. Both were listed as candidates here and neither could
// ever match, which meant only heroes and about sections were ever illustrated
// and product grids stayed grey no matter what plan you were on.
interface Slot {
  hint: string;
  rank: number;
  /** Landscape for a banner, square for a cell in a grid. */
  shape: "landscape" | "square";
  apply: (doc: SiteDocument, url: string) => void;
}

// Most valuable first. The hero is not negotiable: it is the one a visitor
// decides on, and a grey rectangle there is what makes a site look generated.
const RANK = { hero: 0, about: 1, product: 2, gallery: 3 } as const;

function slotsFor(doc: SiteDocument): Slot[] {
  const slots: Slot[] = [];

  doc.sections.forEach((section, si) => {
    const s = section as any;

    // Only claim a slot the renderer will actually paint.
    //
    // A centred or minimal hero renders copy and nothing else, and a statement
    // or centred about does the same. Generating for those spent fifty seconds
    // and, on the free tier, the site's ONE image, on a picture no visitor ever
    // sees: a page could come back with a photograph attached to it and still
    // look like it had none. Keep this in step with renderHero/renderAbout in
    // shared/renderer.ts.
    const paints =
      s.type === "hero"
        ? s.videoUrl || s.layout === "split" || s.layout === "overlay"
        : s.layout === "split";

    if ((s.type === "hero" || s.type === "about") && paints && s.imageHint && !s.image) {
      slots.push({
        hint: s.imageHint,
        rank: s.type === "hero" ? RANK.hero : RANK.about,
        shape: "landscape",
        apply: (d, url) => {
          (d.sections[si] as any).image = { url, alt: s.imageHint };
        },
      });
    }

    if (s.type === "products" && Array.isArray(s.items)) {
      s.items.forEach((item: any, ii: number) => {
        if (!item?.imageHint || item.image) return;
        slots.push({
          hint: item.imageHint,
          rank: RANK.product,
          shape: "square",
          apply: (d, url) => {
            (d.sections[si] as any).items[ii].image = { url, alt: item.imageHint };
          },
        });
      });
    }

    if (s.type === "gallery" && Array.isArray(s.imageHints)) {
      s.imageHints.forEach((hint: string, gi: number) => {
        if (!hint || s.imageUrls?.[gi]) return;
        slots.push({
          hint,
          rank: RANK.gallery,
          shape: "square",
          apply: (d, url) => {
            const target = d.sections[si] as any;
            target.imageUrls = target.imageUrls ?? [];
            target.imageUrls[gi] = { url, alt: hint };
          },
        });
      });
    }
  });

  return slots.sort((a, b) => a.rank - b.rank);
}

/**
 * Fill image slots in a document, best-effort. Returns a NEW document; slots
 * that fail keep their gradient.
 *
 * `limit` bounds cost and latency, and is why this is not simply "every slot":
 * one image is a measured ~50s and several hundred KB inline, and the deployment
 * takes one call at a time, so N images is N x 50s of wall clock. Free gets the
 * hero, Pro gets the next few. Slots are ranked rather than taken in document
 * order, so a page whose gallery precedes its hero does not spend its one image
 * on a gallery cell.
 */
export async function addGeneratedImages(
  doc: SiteDocument,
  limit = 2,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteDocument> {
  if (!imagesEnabled() || limit < 1) return doc;

  const chosen = slotsFor(doc).slice(0, limit);
  if (!chosen.length) return doc;

  const results = await Promise.all(
    chosen.map(async (slot) => ({
      slot,
      url: await generateSiteImage(slot.hint, slot.shape, fetchImpl),
    })),
  );

  const filled = results.filter((r) => r.url);
  if (!filled.length) return doc;

  // Deep clone before mutating: callers hold the input document (the client is
  // still rendering it) and slot.apply writes several levels down.
  const next: SiteDocument = JSON.parse(JSON.stringify(doc));
  for (const { slot, url } of filled) slot.apply(next, url!);
  return next;
}
