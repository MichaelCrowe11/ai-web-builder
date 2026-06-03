import { describe, it, expect, beforeEach } from "vitest";
import { MemStorage } from "../storage";
import { publishProjectRecord } from "../publish";
import type { InsertProject } from "@shared/schema";

describe("publishProjectRecord", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("assigns a slug, marks published, returns a public url", async () => {
    const p = await s.createProject({ userId: null, name: "Joe's Cafe", html: "<h1/>", css: "", prompt: "x" } as InsertProject);
    const r = await publishProjectRecord(p, s);
    expect(r.slug).toMatch(/^joe-s-cafe/);
    expect(r.publishedUrl).toContain(r.slug);
    const reloaded = await s.getProject(p.id);
    expect(reloaded?.isPublished).toBe(true);
  });

  it("appends a suffix when the slug base collides", async () => {
    const a = await s.createProject({ userId: null, name: "Cafe", html: "<h1/>", css: "", prompt: "x" } as InsertProject);
    const b = await s.createProject({ userId: null, name: "Cafe", html: "<h1/>", css: "", prompt: "y" } as InsertProject);
    const ra = await publishProjectRecord(a, s);
    const rb = await publishProjectRecord(b, s);
    expect(ra.slug).not.toBe(rb.slug);
  });
});
