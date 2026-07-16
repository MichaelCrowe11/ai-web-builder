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

  it("sets a default optimization goal on publish so the living site is turnkey", async () => {
    const p = await s.createProject({ userId: null, name: "Joe's Cafe", html: "<h1/>", css: "", prompt: "x" } as InsertProject);
    expect(await s.getGoal(p.id)).toBeUndefined();
    await publishProjectRecord(p, s);
    const goal = await s.getGoal(p.id);
    expect(goal?.objective).toBe("capture_lead");
    expect(goal?.conversionEvent).toBe("primary_cta_click");
    // "suggest" keeps the agent proposing rather than mutating a live site unattended.
    expect(goal?.constraints.autonomy).toBe("suggest");
  });

  it("never overwrites an owner's existing goal on re-publish", async () => {
    const p = await s.createProject({ userId: null, name: "Joe's Cafe", html: "<h1/>", css: "", prompt: "x" } as InsertProject);
    await s.setGoal(p.id, {
      objective: "sell_product",
      conversionEvent: "add_to_cart",
      constraints: { lockedSectionIds: [], lockedCopy: true, autonomy: "auto", minExposuresPerVariant: 200 },
    });
    await publishProjectRecord(p, s);
    const goal = await s.getGoal(p.id);
    expect(goal?.objective).toBe("sell_product");
    expect(goal?.constraints.autonomy).toBe("auto");
  });
});
