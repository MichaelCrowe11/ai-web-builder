import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "./storage";
import type { SiteDocument } from "@shared/site-document";

const hasDb = !!(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);

const doc = (heading: string): SiteDocument => ({
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "minimal", radius: "medium" } as SiteDocument["theme"],
  sections: [{ type: "hero", headline: heading, subheadline: "x", cta: { label: "Go", action: "scroll-contact" } } as any],
});

describe.skipIf(!hasDb)("storage document versioning", () => {
  let projectId: string;
  beforeAll(async () => {
    const user = await storage.createUser({ username: `u_${Date.now()}`, password: "x" } as any);
    const p = await storage.createProject({ userId: user.id, html: "", css: "" } as any);
    projectId = p.id;
  });

  it("saves incrementing versions and returns the latest", async () => {
    const v1 = await storage.saveDocumentVersion(projectId, doc("One"));
    const v2 = await storage.saveDocumentVersion(projectId, doc("Two"));
    expect(v2.version).toBe(v1.version + 1);
    const latest = await storage.getLatestDocument(projectId);
    expect((latest!.document.sections[0] as any).headline).toBe("Two");
    expect(latest!.version).toBe(v2.version);
  });

  it("restores a prior version by writing it as a new version", async () => {
    const restored = await storage.restoreDocumentVersion(projectId, 1);
    const latest = await storage.getLatestDocument(projectId);
    expect((latest!.document.sections[0] as any).headline).toBe("One");
    expect(latest!.version).toBe(restored.version);
  });
});
