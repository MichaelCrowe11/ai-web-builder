import { describe, it, expect, vi, beforeEach } from "vitest";

// The module reads its config at import time, so the env has to be in place
// before it is loaded.
process.env.AZURE_CORE_ENDPOINT = "https://example.invalid";
process.env.AZURE_CORE_API_KEY = "test-key";

const { generateSiteImage, addGeneratedImages } = await import("./azure-image");

const okBody = { data: [{ b64_json: "QUJD" }] };

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("generateSiteImage", () => {
  beforeEach(() => vi.useRealTimers());

  it("returns a data URI on success", async () => {
    const f = vi.fn(async () => response(200, okBody));
    await expect(generateSiteImage("a loaf", "landscape", f as any)).resolves.toBe(
      "data:image/jpeg;base64,QUJD",
    );
  });

  // The bug this exists to prevent: the deployment allows one call at a time,
  // and the old code treated a 429 as "no image" and returned a gradient.
  it("retries a 429 instead of giving up on the image", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(response(429, { error: {} }, { "retry-after": "0" }))
      .mockResolvedValueOnce(response(200, okBody));
    await expect(generateSiteImage("a loaf", "landscape", f as any)).resolves.toBe(
      "data:image/jpeg;base64,QUJD",
    );
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("gives up on a non-retryable status without burning attempts", async () => {
    const f = vi.fn(async () => response(400, { error: {} }));
    await expect(generateSiteImage("a loaf", "landscape", f as any)).resolves.toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("serialises calls, because concurrent ones are what triggered the 429", async () => {
    let inFlight = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return response(200, okBody);
    });
    await Promise.all([
      generateSiteImage("one", "landscape", f as any),
      generateSiteImage("two", "landscape", f as any),
      generateSiteImage("three", "landscape", f as any),
    ]);
    expect(peak).toBe(1);
  });
});

describe("addGeneratedImages", () => {
  const doc = (sections: any[]) =>
    ({ version: 1, meta: { name: "A", tagline: "t" }, theme: { preset: "modern-minimal", radius: "medium" }, sections }) as any;

  it("spends a single image on the hero even when it is not first", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([
        { type: "gallery", title: "G", imageHint: "a shelf" },
        { type: "hero", layout: "split", headline: "H", imageHint: "a loaf" },
      ]),
      1,
      f as any,
    );
    expect((out.sections[1] as any).image?.url).toBe("data:image/jpeg;base64,QUJD");
    expect((out.sections[0] as any).image).toBeUndefined();
  });

  it("leaves the document alone when the limit is zero", async () => {
    const input = doc([{ type: "hero", layout: "split", headline: "H", imageHint: "a loaf" }]);
    await expect(addGeneratedImages(input, 0)).resolves.toBe(input);
  });

  // The gap this closes: products carry a hint PER ITEM and galleries carry an
  // array of hints, so a section-level lookup matched neither and product grids
  // stayed grey on every plan.
  it("fills product items, which have their own hints", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([
        {
          type: "products",
          title: "P",
          items: [{ name: "a", imageHint: "a mug" }, { name: "b", imageHint: "a bowl" }],
        },
      ]),
      2,
      f as any,
    );
    const items = (out.sections[0] as any).items;
    expect(items[0].image?.url).toBe("data:image/jpeg;base64,QUJD");
    expect(items[1].image?.url).toBe("data:image/jpeg;base64,QUJD");
  });

  it("fills gallery cells index-aligned, leaving already-resolved cells alone", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([
        {
          type: "gallery",
          title: "G",
          imageHints: ["one", "two"],
          imageUrls: [{ url: "https://example.com/kept.jpg" }],
        },
      ]),
      4,
      f as any,
    );
    const urls = (out.sections[0] as any).imageUrls;
    expect(urls[0].url).toBe("https://example.com/kept.jpg");
    expect(urls[1].url).toBe("data:image/jpeg;base64,QUJD");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("spends its one image on the hero before any product or gallery slot", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([
        { type: "gallery", title: "G", imageHints: ["a shelf"] },
        { type: "products", title: "P", items: [{ name: "a", imageHint: "a mug" }] },
        { type: "hero", layout: "split", headline: "H", imageHint: "a loaf" },
      ]),
      1,
      f as any,
    );
    expect((out.sections[2] as any).image?.url).toBe("data:image/jpeg;base64,QUJD");
    expect((out.sections[0] as any).imageUrls).toBeUndefined();
    expect((out.sections[1] as any).items[0].image).toBeUndefined();
  });

  // A centred hero renders copy and nothing else, so an image generated for it
  // is fifty seconds and, on the free tier, the site's only image, spent on a
  // picture no visitor ever sees.
  it("skips hero layouts the renderer does not paint an image into", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([{ type: "hero", layout: "centered", headline: "H", imageHint: "a loaf" }]),
      2,
      f as any,
    );
    expect(f).not.toHaveBeenCalled();
    expect((out.sections[0] as any).image).toBeUndefined();
  });

  it("still fills a split hero", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([{ type: "hero", layout: "split", headline: "H", imageHint: "a loaf" }]),
      2,
      f as any,
    );
    expect((out.sections[0] as any).image?.url).toBe("data:image/jpeg;base64,QUJD");
  });

  it("gives a centred hero's image to the gallery instead of wasting it", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const out = await addGeneratedImages(
      doc([
        { type: "hero", layout: "centered", headline: "H", imageHint: "a loaf" },
        { type: "gallery", title: "G", imageHints: ["a shelf"] },
      ]),
      1,
      f as any,
    );
    expect((out.sections[1] as any).imageUrls[0].url).toBe("data:image/jpeg;base64,QUJD");
  });

  it("does not mutate the document it was given", async () => {
    const f = vi.fn(async () => response(200, okBody));
    const input = doc([{ type: "hero", layout: "split", headline: "H", imageHint: "a loaf" }]);
    await addGeneratedImages(input, 1, f as any);
    expect((input.sections[0] as any).image).toBeUndefined();
  });
});
