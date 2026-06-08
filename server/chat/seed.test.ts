import { describe, it, expect } from "vitest";
import { MemStorage } from "../storage";
import { seedTurnZeroTranscript, TURN_ZERO_DRAFT_REPLY } from "./seed";

describe("seedTurnZeroTranscript", () => {
  it("records the founding prompt + draft reply on an empty transcript", async () => {
    const s = new MemStorage();
    await seedTurnZeroTranscript(s, "p1", "A site for a pottery studio");
    const msgs = await s.getChatMessages("p1");
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "A site for a pottery studio"],
      ["assistant", TURN_ZERO_DRAFT_REPLY],
    ]);
  });

  it("no-ops when the transcript already has messages (idempotent on re-save)", async () => {
    const s = new MemStorage();
    await s.addChatMessage({ projectId: "p1", role: "user", content: "existing", toolEvents: null, docVersion: null });
    await seedTurnZeroTranscript(s, "p1", "A site for a pottery studio");
    expect(await s.getChatMessages("p1")).toHaveLength(1);
  });

  it("no-ops on a blank prompt", async () => {
    const s = new MemStorage();
    await seedTurnZeroTranscript(s, "p1", "  ");
    expect(await s.getChatMessages("p1")).toHaveLength(0);
  });
});
