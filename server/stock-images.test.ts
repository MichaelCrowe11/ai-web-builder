import { describe, it, expect, vi } from "vitest";
import { resolveImage, resolveDocumentImages } from "./stock-images";
import type { SiteDocument, ResolvedImage } from "@shared/site-document";

function resp(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const unsplashHit = (url = "https://images.unsplash.com/photo-1") =>
  resp(200, {
    results: [
      { urls: { regular: url }, alt_description: "a loaf", user: { name: "Jane Doe", links: { html: "https://unsplash.com/@jane" } } },
    ],
  });

describe("resolveImage", () => {
  it("parses an Unsplash hit into a ResolvedImage and queries the hint + orientation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unsplashHit());
    const img = await resolveImage("sourdough loaf", "landscape", { apiKey: "k", fetchImpl, cache: new Map() });
    expect(img).toMatchObject({ url: "https://images.unsplash.com/photo-1", alt: "a loaf", credit: "Jane Doe" });
    expect(img?.creditUrl).toContain("utm_source=ai_web_builder");
    const calledUrl = fetchImpl.mock.calls[0][0] as string;
    expect(calledUrl).toContain("sourdough%20loaf");
    expect(calledUrl).toContain("orientation=landscape");
  });

  it("returns null and does NOT fetch when the api key is missing", async () => {
    const fetchImpl = vi.fn();
    const img = await resolveImage("anything", "squarish", { apiKey: undefined, fetchImpl, cache: new Map() });
    expect(img).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null on a non-2xx response (no throw)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(500, { error: "boom" }));
    expect(await resolveImage("x", "landscape", { apiKey: "k", fetchImpl, cache: new Map() })).toBeNull();
  });

  it("returns null on a network error (no throw)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(await resolveImage("x", "landscape", { apiKey: "k", fetchImpl, cache: new Map() })).toBeNull();
  });

  it("returns null when the provider returns no results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, { results: [] }));
    expect(await resolveImage("x", "landscape", { apiKey: "k", fetchImpl, cache: new Map() })).toBeNull();
  });

  it("caches by hint so repeated calls fetch once", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unsplashHit());
    const cache = new Map<string, ResolvedImage | null>();
    await resolveImage("same hint", "landscape", { apiKey: "k", fetchImpl, cache });
    await resolveImage("same hint", "landscape", { apiKey: "k", fetchImpl, cache });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("resolveDocumentImages", () => {
  const baseDoc = (): SiteDocument => ({
    version: 1,
    meta: { name: "Co" },
    theme: { preset: "modern-minimal", radius: "medium" },
    sections: [
      { type: "hero", layout: "split", headline: "H", imageHint: "storefront at dusk" } as any,
      { type: "products", layout: "grid", title: "P", items: [{ name: "Pie", imageHint: "apple pie" }] } as any,
      { type: "gallery", layout: "grid-uniform", title: "G", imageHints: ["a", "b"] } as any,
    ],
  });

  it("fills resolved image fields when a key is present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unsplashHit("https://img/x.jpg"));
    const out = await resolveDocumentImages(baseDoc(), { apiKey: "k", fetchImpl, cache: new Map() });
    const hero: any = out.sections[0];
    const products: any = out.sections[1];
    const gallery: any = out.sections[2];
    expect(hero.image.url).toBe("https://img/x.jpg");
    expect(products.items[0].image.url).toBe("https://img/x.jpg");
    expect(gallery.imageUrls).toHaveLength(2);
  });

  it("returns the document unchanged when no key is configured (graceful fallback)", async () => {
    const fetchImpl = vi.fn();
    const input = baseDoc();
    const out = await resolveDocumentImages(input, { apiKey: undefined, fetchImpl });
    expect(out).toBe(input); // fast path, untouched
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
