import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemStorage } from "../storage";
import { buildAndPublishSite } from "./build-service";
import type { SiteDocument } from "@shared/site-document";

// Minimal but VALID SiteDocument so renderDocumentBody/renderDocumentCss
// actually execute without throwing.
const fakeDoc: SiteDocument = {
  version: 1,
  meta: { name: "Acme Co" },
  theme: { preset: "modern-minimal", radius: "medium" },
  sections: [
    {
      type: "hero",
      layout: "centered",
      headline: "Welcome to Acme Co",
    },
  ],
};

describe("buildAndPublishSite", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("generates, publishes unclaimed, returns url + claim token + document", async () => {
    const generate = vi.fn().mockResolvedValue(fakeDoc);
    const r = await buildAndPublishSite("a cafe site", { storage: s, generate });

    expect(generate).toHaveBeenCalledWith("a cafe site");
    expect(r.document).toBe(fakeDoc);
    expect(r.siteUrl).toContain(r.slug);
    expect(r.claimToken).toMatch(/^[0-9a-f]{64}$/);

    const project = await s.getProject(r.projectId);
    expect(project?.userId).toBeNull();      // unclaimed
    expect(project?.isPublished).toBe(true);
    expect(project?.html).not.toBe("");      // renderer actually ran

    const { hashToken } = await import("./claim-tokens");
    const row = await s.getClaimTokenByHash(hashToken(r.claimToken));
    expect(row?.projectId).toBe(r.projectId);
  });

  it("propagates an AtCapacityError from the limiter without creating a project", async () => {
    const { AtCapacityError } = await import("../gen-limiter");
    const generate = vi.fn().mockRejectedValue(new AtCapacityError(8000));
    await expect(buildAndPublishSite("x", { storage: s, generate })).rejects.toBeInstanceOf(AtCapacityError);
  });
});
