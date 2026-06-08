import { describe, it, expect } from "vitest";
import { MemStorage } from "./storage";
import { publishProjectVersionRecord } from "./publish";

describe("publishProjectVersionRecord", () => {
  it("serves the version snapshot, marks published, and records publishedVersionId", async () => {
    const s = new MemStorage();
    const p = await s.createProject({ userId: "u1", name: "Studio", html: "<h1>draft</h1>", css: "draft{}", prompt: null });
    // The mutable draft moves on after the version was saved...
    await s.updateProject(p.id, { html: "<h1>NEWER DRAFT</h1>", css: "newer{}" });
    const v = await s.createProjectVersion({ projectId: p.id, versionNumber: 1, name: "Studio v1", html: "<h1>v1 snapshot</h1>", css: "v1{}", prompt: null });

    const out = await publishProjectVersionRecord(p.id, v, s);

    expect(out.slug).toBeTruthy();
    expect(out.publishedUrl).toContain(out.slug);
    const after = await s.getProject(p.id);
    // Deploy serves the VERSION, not the newer mutable draft.
    expect(after!.html).toBe("<h1>v1 snapshot</h1>");
    expect(after!.css).toBe("v1{}");
    expect(after!.isPublished).toBe(true);
    expect(after!.publishedVersionId).toBe(v.id);
  });

  it("claims an anonymous project for the deploying user in the same write", async () => {
    const s = new MemStorage();
    const p = await s.createProject({ userId: null, name: "Anon", html: "h", css: "", prompt: null });
    const v = await s.createProjectVersion({ projectId: p.id, versionNumber: 1, name: "Anon", html: "h", css: "", prompt: null });
    await publishProjectVersionRecord(p.id, v, s, "claimer-1");
    expect((await s.getProject(p.id))!.userId).toBe("claimer-1");
  });
});
