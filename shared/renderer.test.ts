import { describe, it, expect } from "vitest";
import { renderDocumentBody, renderDocumentFull, renderDocumentCss } from "@shared/renderer";
import type { SiteDocument } from "@shared/site-document";

const doc = (sections: any[], theme: any = { preset: "modern-minimal", radius: "medium" }): SiteDocument =>
  ({ version: 1, meta: { name: "A", tagline: "t" }, theme, sections } as any);

describe("renderDocumentBody instrumentation", () => {
  it("tags each section with its data-section-key", () => {
    expect(renderDocumentBody(doc([{ type: "hero", headline: "H", subheadline: "x", cta: { label: "G", action: "scroll-contact" } }])))
      .toContain('data-section-key="0:hero"');
  });

  it("marks CTA buttons as conversion points", () => {
    expect(renderDocumentBody(doc([{ type: "cta", headline: "Book now", cta: { label: "Call us", action: "call" } }])))
      .toContain("data-conversion");
  });
});

describe("layout variants", () => {
  it("hero defaults to centered when layout omitted (backward compat)", () => {
    expect(renderDocumentBody(doc([{ type: "hero", headline: "H" }]))).toContain("hero--centered");
  });

  it("renders the chosen variant class for each section type", () => {
    const cases: Array<[any, string]> = [
      [{ type: "hero", layout: "split", headline: "H" }, "hero--split"],
      [{ type: "hero", layout: "overlay", headline: "H" }, "hero--overlay"],
      [{ type: "services", layout: "feature", title: "S", items: [{ name: "n", description: "d" }] }, "svc-feature"],
      [{ type: "services", layout: "list", title: "S", items: [{ name: "n", description: "d" }] }, "svc-list"],
      [{ type: "menu", layout: "columns", title: "M", items: [{ name: "n" }] }, "menu-list--cols"],
      [{ type: "products", layout: "showcase", title: "P", items: [{ name: "n" }] }, "product--hero"],
      [{ type: "about", layout: "statement", title: "Ab", body: "b" }, "about--statement"],
      [{ type: "gallery", layout: "masonry", title: "G", imageHints: ["a", "b"] }, "gallery--masonry"],
      [{ type: "testimonials", layout: "marquee", title: "T", items: [{ quote: "q", author: "a" }] }, "quote-marquee"],
      [{ type: "contact", layout: "stacked", title: "C", email: "a@b.com" }, "contact-grid--stacked"],
      [{ type: "cta", layout: "boxed", headline: "h", cta: { label: "x", action: "none" } }, "cta-box"],
    ];
    for (const [section, cls] of cases) {
      expect(renderDocumentBody(doc([section]))).toContain(cls);
    }
  });
});

describe("imagery", () => {
  it("renders a real <img> when a resolved image is present", () => {
    const html = renderDocumentBody(doc([
      { type: "products", title: "P", items: [{ name: "n", image: { url: "https://img.example.com/p.jpg", alt: "a pie", credit: "Jane" } }] },
    ]));
    expect(html).toContain("<img");
    expect(html).toContain('src="https://img.example.com/p.jpg"');
    expect(html).toContain("photo-credit");
    expect(html).toContain("Jane");
  });

  it("falls back to the gradient placeholder when no image is resolved", () => {
    const html = renderDocumentBody(doc([
      { type: "products", title: "P", items: [{ name: "n" }] },
    ]));
    expect(html).toContain("product-img--ph");
    expect(html).not.toContain("<img");
  });

  it("gallery uses resolved imageUrls per index, gradient where missing", () => {
    const html = renderDocumentBody(doc([
      { type: "gallery", title: "G", imageHints: ["a", "b"], imageUrls: [{ url: "https://img.example.com/g.jpg" }] },
    ]));
    expect(html).toContain('src="https://img.example.com/g.jpg"');
    expect(html).toContain("gallery-cell"); // the second, unresolved cell
  });
});

describe("theme presets", () => {
  it("renders a new preset and emits its font import", () => {
    const full = renderDocumentFull(doc([{ type: "hero", headline: "H" }], { preset: "nocturne-luxe", radius: "small" }));
    expect(full).toContain("Playfair+Display");
    expect(renderDocumentCss(doc([], { preset: "nocturne-luxe", radius: "small" }))).toContain("--accent:#d9a679");
  });

  it("falls back gracefully for an unknown preset (load-bearing)", () => {
    expect(() => renderDocumentCss(doc([], { preset: "minimal", radius: "medium" }))).not.toThrow();
  });
});
