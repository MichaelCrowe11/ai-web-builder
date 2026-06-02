import { describe, it, expect } from "vitest";
import type { SiteDocument } from "@shared/site-document";
import { sectionKey, findSectionIndex, patchSection } from "@shared/section-key";

const doc = (): SiteDocument => ({
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "minimal", radius: "medium" } as SiteDocument["theme"],
  sections: [
    { type: "hero", heading: "Old", subheading: "x", ctaLabel: "Go", ctaHref: "#" } as any,
    { type: "cta", heading: "Book", ctaLabel: "Call", ctaHref: "#" } as any,
  ],
});

describe("section-key", () => {
  it("derives a stable key from index + type", () => {
    expect(sectionKey(doc(), 0)).toBe("0:hero");
    expect(sectionKey(doc(), 1)).toBe("1:cta");
  });

  it("finds the index for a key, or -1", () => {
    expect(findSectionIndex(doc(), "1:cta")).toBe(1);
    expect(findSectionIndex(doc(), "5:hero")).toBe(-1);
    expect(findSectionIndex(doc(), "0:cta")).toBe(-1); // type must match too
  });

  it("patchSection replaces in place and returns a NEW document (no mutation)", () => {
    const d = doc();
    const replacement = { type: "hero", heading: "New", subheading: "y", ctaLabel: "Go", ctaHref: "#" } as any;
    const next = patchSection(d, "0:hero", replacement);
    expect((next.sections[0] as any).heading).toBe("New");
    expect((d.sections[0] as any).heading).toBe("Old"); // original untouched
    expect(next).not.toBe(d);
  });

  it("patchSection throws if the key does not resolve", () => {
    expect(() => patchSection(doc(), "9:hero", {} as any)).toThrow(/no section/i);
  });
});
