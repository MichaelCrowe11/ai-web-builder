// ============================================================================
// Stock image resolution. Generated documents carry imageHints (the AI's words);
// after generation we resolve each hint to a real photo URL via a stock API and
// store it back in the document, so the renderer stays pure and no API key ever
// reaches the browser. Best-effort: any failure (no key, non-2xx, empty, network)
// returns null and the renderer falls back to its gradient placeholder.
// ============================================================================
import type { SiteDocument, Section, ResolvedImage } from "@shared/site-document";

export type Orientation = "landscape" | "portrait" | "squarish";
export type StockProvider = "unsplash" | "pexels";

export interface StockOpts {
  apiKey?: string;
  provider?: StockProvider;
  fetchImpl?: typeof fetch;
  cache?: Map<string, ResolvedImage | null>;
}

// Process-wide cache so repeated hints (and re-renders within a session) are free.
// Negative results are cached too, to avoid hammering a bad hint.
const moduleCache = new Map<string, ResolvedImage | null>();

function searchUrl(provider: StockProvider, hint: string, orientation: Orientation): string {
  const q = encodeURIComponent(hint);
  if (provider === "pexels") {
    return `https://api.pexels.com/v1/search?query=${q}&per_page=1&orientation=${orientation}`;
  }
  return `https://api.unsplash.com/search/photos?query=${q}&per_page=1&orientation=${orientation}`;
}

function authHeader(provider: StockProvider, apiKey: string): Record<string, string> {
  // Unsplash uses "Client-ID <key>"; Pexels uses the raw key.
  return { Authorization: provider === "pexels" ? apiKey : `Client-ID ${apiKey}` };
}

function parse(provider: StockProvider, data: any, hint: string): ResolvedImage | null {
  if (provider === "pexels") {
    const p = data?.photos?.[0];
    const url = p?.src?.large ?? p?.src?.medium;
    if (!url) return null;
    return { url, alt: p.alt || hint, credit: p.photographer, creditUrl: p.photographer_url };
  }
  const r = data?.results?.[0];
  const url = r?.urls?.regular ?? r?.urls?.full;
  if (!url) return null;
  const creditUrl = r.user?.links?.html
    ? `${r.user.links.html}?utm_source=ai_web_builder&utm_medium=referral`
    : undefined;
  return { url, alt: r.alt_description || hint, credit: r.user?.name, creditUrl };
}

/** Resolve a single hint to a stock photo. Returns null on any failure. */
export async function resolveImage(
  hint: string,
  orientation: Orientation,
  opts: StockOpts = {},
): Promise<ResolvedImage | null> {
  const { apiKey, fetchImpl = fetch } = opts;
  const provider: StockProvider = opts.provider ?? "unsplash";
  if (!apiKey || !hint.trim()) return null; // no key / empty hint => placeholder, no fetch

  const cache = opts.cache ?? moduleCache;
  const cacheKey = `${provider}:${orientation}:${hint.trim().toLowerCase()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  let result: ResolvedImage | null = null;
  try {
    const res = await fetchImpl(searchUrl(provider, hint, orientation), {
      headers: authHeader(provider, apiKey),
    });
    if (res.ok) {
      result = parse(provider, await res.json(), hint);
    }
  } catch {
    result = null; // network/transport error => placeholder
  }
  cache.set(cacheKey, result);
  return result;
}

const ORIENTATION: Partial<Record<Section["type"], Orientation>> = {
  hero: "landscape",
  about: "landscape",
  products: "squarish",
  gallery: "squarish",
};

/**
 * Walk a document, resolve every imageHint into the resolved-image fields, and
 * return a NEW document (never mutates the input). Resolution is best-effort and
 * runs in parallel; if no apiKey is configured the document is returned unchanged.
 */
export async function resolveDocumentImages(doc: SiteDocument, opts: StockOpts = {}): Promise<SiteDocument> {
  if (!opts.apiKey) return doc; // fast path: feature disabled, gradient placeholders

  const sections = await Promise.all(
    doc.sections.map(async (s): Promise<Section> => {
      switch (s.type) {
        case "hero": {
          if (s.imageHint && !s.image) {
            const img = await resolveImage(s.imageHint, ORIENTATION.hero!, opts);
            if (img) return { ...s, image: img };
          }
          return s;
        }
        case "about": {
          if (s.imageHint && !s.image) {
            const img = await resolveImage(s.imageHint, ORIENTATION.about!, opts);
            if (img) return { ...s, image: img };
          }
          return s;
        }
        case "products": {
          const items = await Promise.all(
            s.items.map(async (it) => {
              if (it.imageHint && !it.image) {
                const img = await resolveImage(it.imageHint, ORIENTATION.products!, opts);
                if (img) return { ...it, image: img };
              }
              return it;
            }),
          );
          return { ...s, items };
        }
        case "gallery": {
          const resolved = await Promise.all(
            s.imageHints.map((h) => resolveImage(h, ORIENTATION.gallery!, opts)),
          );
          // Compact: first N cells get the N resolved photos, the rest fall back to
          // the gradient cell. Avoids index-misalignment with a sparse array.
          const imageUrls = resolved.filter((x): x is ResolvedImage => x != null);
          return imageUrls.length ? { ...s, imageUrls } : s;
        }
        default:
          return s;
      }
    }),
  );

  return { ...doc, sections };
}
