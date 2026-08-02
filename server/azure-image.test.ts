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
        { type: "hero", headline: "H", imageHint: "a loaf" },
      ]),
      1,
      f as any,
    );
    expect((out.sections[1] as any).image?.url).toBe("data:image/jpeg;base64,QUJD");
    expect((out.sections[0] as any).image).toBeUndefined();
  });

  it("leaves the document alone when the limit is zero", async () => {
    const input = doc([{ type: "hero", headline: "H", imageHint: "a loaf" }]);
    await expect(addGeneratedImages(input, 0)).resolves.toBe(input);
  });
});
