// Conversational builder HTTP surface.
//   GET  /api/chat/:projectId/messages  — transcript for panel hydration
//   POST /api/chat/:projectId/turns     — run one agentic turn, streamed as SSE
// POST+SSE (not EventSource) because turns carry a body; the client reads the
// response stream. Quota: Q&A turns always run; quota-exhausted turns lose
// mutating tools; a mutating turn consumes one generation on success.
import type { Express, Request, Response } from "express";
import type { Project } from "@shared/schema";
import { storage } from "../storage";
import { quotaSnapshot, consumeGeneration } from "../quota";
import { runTurn } from "./agent-loop";
import { azureChatTools, modelsFromEnv, type ToolDef, type ToolWireMessage } from "../azure-chat";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { runLimited, AtCapacityError } from "../gen-limiter";
import { log } from "../log";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function canAccessProject(project: Pick<Project, "userId">, sessionUserId: string | undefined): boolean {
  if (!project.userId) return true; // unowned (anonymous builder flow)
  return project.userId === sessionUserId;
}

export function registerChatRoutes(app: Express) {
  // Express 4 doesn't forward async rejections — every handler must catch its own (a rejection here would crash the single prod instance).
  app.get("/api/chat/:projectId/messages", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!canAccessProject(project, req.session.userId)) return res.status(403).json({ error: "Not your project" });
      const messages = await storage.getChatMessages(project.id);
      return res.json({ messages });
    } catch (error: any) {
      log(`Chat messages error: ${error.message}`);
      return res.status(500).json({ error: "Could not load messages" });
    }
  });

  app.post("/api/chat/:projectId/turns", async (req: Request, res: Response) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "message is required" });
    if (message.length > 2000) return res.status(400).json({ error: "message too long" });

    let project: Project | undefined;
    let latest: Awaited<ReturnType<typeof storage.getLatestDocument>>;
    let quota: Awaited<ReturnType<typeof quotaSnapshot>>;
    try {
      project = await storage.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!canAccessProject(project, req.session.userId)) return res.status(403).json({ error: "Not your project" });

      latest = await storage.getLatestDocument(project.id);
      if (!latest) return res.status(409).json({ error: "Generate a site before chatting about it" });

      quota = await quotaSnapshot(req);

      // Set quotaUser from snapshot if available so consumeGeneration skips a second fetch.
      if (quota.user) req.quotaUser = quota.user;
    } catch (error: any) {
      log(`Chat turn setup error: ${error.message}`);
      return res.status(500).json({ error: "Could not start the turn" });
    }

    // Send headers BEFORE any await that can throw — errors after this point go
    // down the stream as error events, never a half-JSON 500.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // If the client disconnects mid-turn, res.write becomes a silent no-op but
    // the turn still completes: doc version + transcript persist, quota is
    // consumed, and the client rehydrates via GET /messages on reconnect.
    const send = (event: string, data: unknown) => res.write(sseFrame(event, data));

    try {
      // Fetch prior history BEFORE persisting the user message so that the
      // history slice passed to runTurn does not include the current message.
      const prior = await storage.getChatMessages(project.id);
      await storage.addChatMessage({ projectId: project.id, role: "user", content: message, toolEvents: null, docVersion: null });

      const result = await runTurn({
        doc: latest.document,
        history: prior.map((m) => ({ role: m.role, content: m.content })),
        userMessage: message,
        allowMutations: quota.ok,
        chatFn: (messages: ToolWireMessage[], tools: ToolDef[]) =>
          // 2000 tokens: replies are 1-2 sentences, but edit_section arguments
          // can carry a full section's copy — 1200 risked truncated tool JSON.
          runLimited(() => azureChatTools(messages, 2000, tools, {
            endpoint: ENDPOINT, apiKey: API_KEY, apiVersion: API_VERSION, models: modelsFromEnv(),
          })),
        onEvent: (e) => {
          if (e.type === "doc_updated") {
            send("doc_updated", {
              document: e.doc,
              html: renderDocumentBody(e.doc),
              css: renderDocumentCss(e.doc),
            });
          } else {
            send(e.type, e);
          }
        },
      });

      let docVersion: number | null = null;
      let quotaState = quota.state;
      if (result.mutated) {
        const saved = await storage.saveDocumentVersion(project.id, result.doc);
        docVersion = saved.version;
        quotaState = await consumeGeneration(req);
      }

      await storage.addChatMessage({
        projectId: project.id, role: "assistant", content: result.reply,
        toolEvents: result.toolEvents, docVersion,
      });

      send("turn_done", { reply: result.reply, mutated: result.mutated, docVersion, quota: quotaState });
    } catch (error: any) {
      const detail = error instanceof AtCapacityError
        ? "High demand right now — that didn't go through. Nothing was changed; try again in a moment."
        : "That didn't go through. Nothing was changed.";
      log(`Chat turn error: ${error.message}`);
      send("error", { error: detail });
    }
    res.end();
  });
}
