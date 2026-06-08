import { describe, it, expect } from "vitest";
import { MemStorage } from "../storage";
import { fixtureDoc } from "./fixtures";

describe("chat message storage", () => {
  it("appends and lists messages per project in order", async () => {
    const s = new MemStorage();
    await s.addChatMessage({ projectId: "p1", role: "user", content: "darker hero", toolEvents: null, docVersion: null });
    await s.addChatMessage({ projectId: "p1", role: "assistant", content: "Done.", toolEvents: [{ name: "edit_section", ok: true, detail: "Editing Hero" }], docVersion: 2 });
    await s.addChatMessage({ projectId: "p2", role: "user", content: "other project", toolEvents: null, docVersion: null });

    const msgs = await s.getChatMessages("p1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].docVersion).toBe(2);
    expect(await s.getChatMessages("p2")).toHaveLength(1);
  });

  it("limit returns the most recent N messages, oldest-first", async () => {
    const s = new MemStorage();
    for (let i = 1; i <= 5; i++) {
      await s.addChatMessage({ projectId: "p1", role: "user", content: `m${i}`, toolEvents: null, docVersion: null });
    }
    const msgs = await s.getChatMessages("p1", 2);
    expect(msgs.map((m) => m.content)).toEqual(["m4", "m5"]);
  });
});

describe("document version persistence (required for chat turns)", () => {
  it("saveDocumentVersion followed by getLatestDocument returns the saved doc", async () => {
    const s = new MemStorage();
    const doc = fixtureDoc();
    // Simulate project creation flow
    const project = await s.createProject({ userId: null, name: "Test", html: "<p>hi</p>", css: "", prompt: null });
    await s.saveDocumentVersion(project.id, doc);
    const latest = await s.getLatestDocument(project.id);
    expect(latest).toBeDefined();
    expect(latest!.version).toBe(1);
    expect(latest!.document.meta.name).toBe("Brava Bakery");
  });

  it("getLatestDocument returns undefined for a project with no saved version", async () => {
    const s = new MemStorage();
    const project = await s.createProject({ userId: null, name: "Empty", html: "<p></p>", css: "", prompt: null });
    const latest = await s.getLatestDocument(project.id);
    expect(latest).toBeUndefined();
  });
});
