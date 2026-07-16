import { describe, it, expect } from "vitest";
import { MemStorage } from "./storage";

describe("project version storage", () => {
  it("creates, fetches, and lists versions newest-first, scoped per project", async () => {
    const s = new MemStorage();
    const p = await s.createProject({ userId: null, name: "Site", html: "<h1>v1</h1>", css: "", prompt: null });

    const v1 = await s.createProjectVersion({ projectId: p.id, versionNumber: 1, name: "Site", html: "<h1>v1</h1>", css: "", prompt: null });
    const v2 = await s.createProjectVersion({ projectId: p.id, versionNumber: 2, name: "Site", html: "<h1>v2</h1>", css: "", prompt: null });
    expect(v1.id).toBeTruthy();
    expect(v1.createdAt).toBeInstanceOf(Date);

    expect(await s.getProjectVersion(v2.id)).toMatchObject({ versionNumber: 2, html: "<h1>v2</h1>" });

    const list = await s.getProjectVersionsByProject(p.id);
    expect(list.map((v) => v.versionNumber)).toEqual([2, 1]); // newest first

    const other = await s.createProject({ userId: null, name: "Other", html: "x", css: "", prompt: null });
    expect(await s.getProjectVersionsByProject(other.id)).toHaveLength(0);
  });

  it("new projects start with publishedVersionId null; deleting a project drops its versions", async () => {
    const s = new MemStorage();
    const p = await s.createProject({ userId: null, name: "Site", html: "h", css: "", prompt: null });
    expect(p.publishedVersionId).toBeNull();

    await s.createProjectVersion({ projectId: p.id, versionNumber: 1, name: "Site", html: "h", css: "", prompt: null });
    await s.deleteProject(p.id);
    expect(await s.getProjectVersionsByProject(p.id)).toHaveLength(0);
  });
});
