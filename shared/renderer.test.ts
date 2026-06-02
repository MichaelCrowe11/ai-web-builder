import { describe, it, expect } from "vitest";
import { renderDocumentBody } from "@shared/renderer";
import type { SiteDocument } from "@shared/site-document";

describe("renderDocumentBody instrumentation", () => {
  it("tags each section with its data-section-key", () => {
    const doc: SiteDocument = {
      version: 1,
      meta: { name: "A" },
      theme: { preset: "minimal", radius: "medium" } as any,
      sections: [
        { type: "hero", headline: "H", subheadline: "x", cta: { label: "G", action: "scroll-contact" } } as any,
      ],
    };
    expect(renderDocumentBody(doc)).toContain('data-section-key="0:hero"');
  });
});
