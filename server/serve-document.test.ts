import { describe, it, expect } from "vitest";
import { assembleDocumentHtml } from "./serve-document";
import type { SiteDocument } from "@shared/site-document";
import type { Experiment } from "@shared/experiment";

const doc: SiteDocument = {
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "minimal", radius: "medium" } as any,
  sections: [
    { type: "hero", headline: "Canonical", subheadline: "x", cta: { label: "Go", action: "scroll-contact" } } as any,
  ],
};

const exp: Experiment = {
  id: "e1",
  siteId: "p1",
  status: "running",
  targetSectionId: "0:hero",
  hypothesis: "h",
  conversionEvent: "c",
  createdBy: "agent",
  minExposuresPerVariant: 200,
  variants: [
    { id: "control", label: "Control", patch: null },
    {
      id: "cand",
      label: "Cand",
      patch: {
        type: "hero",
        headline: "Variant!",
        subheadline: "y",
        cta: { label: "Go", action: "scroll-contact" },
      } as any,
    },
  ],
};

describe("assembleDocumentHtml", () => {
  it("with no experiment, renders the canonical doc + beacon", () => {
    const html = assembleDocumentHtml(doc, "p1", null, "visitor-1");
    expect(html).toContain("Canonical");
    expect(html).toContain("/api/t");
    expect(html).toContain('data-section-key="0:hero"');
  });

  it("beacon emits conversion with the section key", () => {
    const html = assembleDocumentHtml(doc, "p1", null, "v1");
    expect(html).toContain("push('conversion',");
  });

  it("patches in the candidate when the visitor is assigned to it", () => {
    let vid = "";
    for (let i = 0; i < 50; i++) {
      const html = assembleDocumentHtml(doc, "p1", exp, `v${i}`);
      if (html.includes("Variant!")) {
        vid = `v${i}`;
        break;
      }
    }
    expect(vid).not.toBe("");
    const again = assembleDocumentHtml(doc, "p1", exp, vid);
    expect(again).toContain("Variant!");
    expect(again).toContain('"experimentId":"e1"');
  });
});
