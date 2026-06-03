import { describe, it, expect, beforeEach } from "vitest";
import { MemStorage } from "../storage";
import { publishProjectRecord } from "../publish";

describe("publishProjectRecord", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("assigns a slug, marks published, returns a public url", async () => {
    const p = await s.createProject({ userId: null, name: "Joe's Cafe", html: "<h1/>", css: "", prompt: "x" } as any);
    const r = await publishProjectRecord(p, s);
    expect(r.slug).toMatch(/^joe-s-cafe/);
    expect(r.publishedUrl).toContain(r.slug);
    const reloaded = await s.getProject(p.id);
    expect(reloaded?.isPublished).toBe(true);
  });
});
