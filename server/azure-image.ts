// ============================================================================
// Pro image generation via Azure (gpt-image-1 on the existing foundry resource).
// Topical, bespoke images per imageHint - no stock-photo licensing. Each image
// is ~20s and ~200KB, so this runs ASYNC (after the text site is on screen) and
// only for Pro users; free tier keeps the gradient placeholders. Best-effort:
// any failure returns null and the renderer falls back to the gradient.
// ============================================================================
import type { SiteDocument } from "@shared/site-document";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const MODEL = process.env.AI_WEBBUILDER_IMAGE_MODEL ?? "gpt-image-1";
const API_VERSION = process.env.AZURE_IMAGE_API_VERSION ?? "2025-04-01-preview";

export function imagesEnabled(): boolean {
  return !!(ENDPOINT && API_KEY);
}

/** Generate one image for a hint. Returns a JPEG data URI, or null on any failure. */
export async function generateSiteImage(
  hint: string,
  orientation: "landscape" | "portrait" = "landscape",
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!imagesEnabled() || !hint.trim()) return null;
  const size = orientation === "portrait" ? "1024x1536" : "1536x1024";
  const prompt = `${hint}. Professional editorial website photography, natural light, high detail. No text, no words, no watermark, no logo.`;
  try {
    const res = await fetchImpl(
      `${ENDPOINT.replace(/\/$/, "")}/openai/deployments/${MODEL}/images/generations?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": API_KEY },
        body: JSON.stringify({ prompt, n: 1, size, quality: "medium", output_format: "jpeg" }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch {
    return null;
  }
}

/**
 * Add generated images to a document (hero + about, in parallel, best-effort).
 * Returns a NEW document; sections without a successful image keep their gradient.
 * Bounded to 2 images to cap cost/latency; expandable later.
 */
export async function addGeneratedImages(doc: SiteDocument): Promise<SiteDocument> {
  if (!imagesEnabled()) return doc;
  const sections = await Promise.all(
    doc.sections.map(async (s) => {
      const sec = s as any;
      if ((s.type === "hero" || s.type === "about") && sec.imageHint && !sec.image) {
        const url = await generateSiteImage(sec.imageHint, "landscape");
        if (url) return { ...s, image: { url, alt: sec.imageHint } };
      }
      return s;
    }),
  );
  return { ...doc, sections } as SiteDocument;
}
