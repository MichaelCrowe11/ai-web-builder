import { describe, it, expect } from "vitest";
import { siteDocumentSchema, sectionSchema, resolvedImageSchema, THEME_PRESETS } from "./site-document";

describe("site-document schema", () => {
  it("applies the default layout when a section omits it (backward compat)", () => {
    const hero = sectionSchema.parse({ type: "hero", headline: "Hi" });
    expect(hero.type).toBe("hero");
    // @ts-expect-error narrowing for the test
    expect(hero.layout).toBe("centered");

    const services = sectionSchema.parse({ type: "services", items: [{ name: "A", description: "b" }] });
    // @ts-expect-error
    expect(services.layout).toBe("grid");
  });

  it("parses an old-style document (no layout, no image fields)", () => {
    const doc = siteDocumentSchema.parse({
      version: 1,
      meta: { name: "Old Co" },
      theme: { preset: "warm-editorial", radius: "medium" },
      sections: [
        { type: "hero", headline: "Welcome" },
        { type: "about", title: "About", body: "We do things." },
        { type: "contact", title: "Reach us", email: "a@b.com" },
      ],
    });
    expect(doc.sections).toHaveLength(3);
    // defaults filled in
    // @ts-expect-error
    expect(doc.sections[0].layout).toBe("centered");
  });

  it("accepts the new theme presets", () => {
    for (const preset of ["coastal-calm", "industrial-slate", "nocturne-luxe"]) {
      const doc = siteDocumentSchema.parse({
        meta: { name: "X" },
        theme: { preset },
        sections: [{ type: "hero", headline: "H" }],
      });
      expect(doc.theme.preset).toBe(preset);
    }
    expect(THEME_PRESETS).toContain("tech-precision");
    expect(THEME_PRESETS.length).toBe(12);
  });

  it("validates resolved-image fields (good URL passes, non-URL fails)", () => {
    expect(() => resolvedImageSchema.parse({ url: "https://img.example.com/a.jpg", alt: "x" })).not.toThrow();
    expect(() => resolvedImageSchema.parse({ url: "not-a-url" })).toThrow();
  });

  it("accepts a hero with a resolved image + chosen layout", () => {
    const hero = sectionSchema.parse({
      type: "hero",
      layout: "split",
      headline: "H",
      image: { url: "https://img.example.com/h.jpg", credit: "Jane", creditUrl: "https://u.example.com" },
    });
    // @ts-expect-error
    expect(hero.layout).toBe("split");
    // @ts-expect-error
    expect(hero.image.url).toContain("https://");
  });
});
