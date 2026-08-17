// /api/keys — issue and revoke the credentials that let a signed-in person use
// the MCP connector from ChatGPT, Claude, Cursor, or any MCP client.
//
// Session-authenticated on purpose: you prove who you are with the cookie you
// already have, and receive a key you paste into a connector. The key is shown
// exactly ONCE at creation — only its hash is stored, so there is no endpoint
// that can ever return it again.
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { mintApiKey, keyPreview } from "./api-keys";
import { log } from "./log";

// A key names itself so a user with several can tell which connector is which.
const MAX_NAME = 60;
// A soft ceiling: enough for several clients, low enough that a scripted loop
// cannot fill the table on one account.
const MAX_KEYS_PER_USER = 10;

export function registerApiKeyRoutes(app: Express): void {
  // Create a key. The raw value in this response is unrecoverable afterwards.
  app.post("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const name = typeof req.body?.name === "string" ? req.body.name.slice(0, MAX_NAME) : undefined;

    const existing = await storage.listApiKeys(userId);
    if (existing.length >= MAX_KEYS_PER_USER) {
      return res.status(409).json({
        error: "too_many_keys",
        message: `You already have ${MAX_KEYS_PER_USER} active keys. Revoke one before creating another.`,
      });
    }

    const { key, hash } = mintApiKey();
    try {
      const row = await storage.createApiKey(userId, hash, name);
      log(`api key created for user ${userId} (${keyPreview(key)})`);
      return res.status(201).json({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        key, // shown once, never retrievable again
        note: "Save this now. Set it as the Authorization header of your MCP connector: `Bearer <key>`. It cannot be shown again.",
      });
    } catch (err: any) {
      log(`api key create failed for user ${userId}: ${err.message}`);
      return res.status(500).json({ error: "key_create_failed" });
    }
  });

  // List active keys. Never includes the raw key or its hash — the hash is a
  // verifier, and echoing it back would hand out an offline cracking target.
  app.get("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const rows = await storage.listApiKeys(req.session.userId!);
    return res.json({
      keys: rows.map((k) => ({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      })),
    });
  });

  // Revoke. Scoped to the caller's own keys inside the storage layer, so a
  // guessed id belonging to another account cannot be revoked.
  app.delete("/api/keys/:id", requireAuth, async (req: Request, res: Response) => {
    const ok = await storage.revokeApiKey(req.params.id, req.session.userId!);
    if (!ok) return res.status(404).json({ error: "key_not_found" });
    return res.json({ ok: true });
  });
}
