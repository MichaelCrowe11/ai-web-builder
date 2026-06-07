import { describe, it, expect } from "vitest";
import { MemStorage } from "../storage";

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
});
