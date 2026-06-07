// Turn-zero transcript seeding. The first exchange (founding prompt → draft
// confirmation) happens client-side before a project exists; when the project
// is created we record it server-side so the conversation survives reload and
// other devices. Mirrors the panel's client stub copy.

import type { MemStorage } from "../storage";

// Keep in sync with the chat panel's turn-zero stub (chat-panel.tsx).
export const TURN_ZERO_DRAFT_REPLY = "Here’s the first draft. Tell me what to change.";

type ChatStore = Pick<MemStorage, "getChatMessages" | "addChatMessage">;

export async function seedTurnZeroTranscript(storage: ChatStore, projectId: string, prompt: string): Promise<void> {
  const founding = prompt?.trim();
  if (!founding) return;
  const existing = await storage.getChatMessages(projectId, 1);
  if (existing.length > 0) return; // only ever seed a virgin transcript
  await storage.addChatMessage({ projectId, role: "user", content: founding, toolEvents: null, docVersion: null });
  await storage.addChatMessage({ projectId, role: "assistant", content: TURN_ZERO_DRAFT_REPLY, toolEvents: null, docVersion: null });
}
