// Conversational builder HTTP surface.
//   GET  /api/chat/:projectId/messages  — transcript for panel hydration
//   POST /api/chat/:projectId/turns     — run one agentic turn, streamed as SSE
//   POST /api/chat/:projectId/undo      — revert to a prior document version
//   GET  /api/quota                     — current quota state for the panel pill
// POST+SSE (not EventSource) because turns carry a body; the client reads the
// response stream. Quota: Q&A turns always run; quota-exhausted turns lose
// mutating tools; a mutating turn consumes one generation on success.
import type { Express, Request, Response } from "express";
import type { Project } from "@shared/schema";
import { storage } from "../storage";
import { quotaSnapshot, consumeGeneration } from "../quota";
import { runTurn } from "./agent-loop";
import { buildServiceTools } from "./media-tools";
import { ToolInputError } from "./site-tools";
import { azureChatTools, modelsFromEnvForPlan, type ToolDef, type ToolWireMessage } from "../azure-chat";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { runLimited, AtCapacityError } from "../gen-limiter";
import { generateSiteImage } from "../azure-image";
import { startVideo, videoEnabled } from "../azure-video";
import { generateDocument } from "../document-gen";
import { resolveDocumentImages, type StockProvider } from "../stock-images";
import { log } from "../log";

// Read stock image opts at call time (mirrors routes.ts stockOpts helper).
const stockOpts = () => ({
  apiKey: process.env.STOCK_IMAGE_API_KEY,
  provider: process.env.STOCK_IMAGE_PROVIDER as StockProvider | undefined,
});

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

    // Build serviceTools AFTER send is defined — the onVideoStarted callback
    // closes over send to emit video_started SSE events mid-turn.
    const isPro = quota.user?.plan === "pro";
    const serviceTools = buildServiceTools(isPro, {
      generateSiteImage,
      startVideo: async (prompt: string) => {
        // Configuration guard: surfaced as a model-correctable error so the
        // agent can tell the user rather than crashing the turn.
        if (!videoEnabled()) {
          throw new ToolInputError("video rendering is not available right now");
        }
        // startVideo returns null on any network/api failure; convert to error.
        const id = await startVideo(prompt);
        if (!id) throw new ToolInputError("video rendering could not be started; tell the user and move on");
        return id;
      },
      rebuildDocument: async (prompt: string) => {
        const raw = await runLimited(() => generateDocument(prompt, quota.state.plan));
        return resolveDocumentImages(raw, stockOpts());
      },
      onVideoStarted: (videoId: string) => send("video_started", { videoId }),
      onUpsell: (feature: string) => send("upsell", { feature }),
    });
    const turnServiceTools = !isPro && !quota.ok
      ? { ...serviceTools, defs: serviceTools.defs.filter((d) => d.function.name === "suggest_upgrade") }
      : serviceTools;

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
            endpoint: ENDPOINT, apiKey: API_KEY, apiVersion: API_VERSION, models: modelsFromEnvForPlan(quota.state.plan),
            // Optimistic streaming: fragments paint as they arrive; turn_done's
            // reply is authoritative and replaces them (retry-safe).
            onDelta: (text) => send("assistant_delta", { text }),
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
        serviceTools: turnServiceTools,
        systemNote: isPro
          ? undefined
          : "Photo and video generation are Pro features the user's plan does not include. If they ask for imagery, do NOT edit imageHint as a substitute (it has no visible effect). Call suggest_upgrade once, then reply with one short sentence.",
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

  // Revert to a prior document version (the undo affordance in the panel).
  // restoreDocumentVersion writes the restored doc as a NEW version, so undo
  // is itself undoable. The re-rendered html/css is also written to the project
  // row so every serve path (published site, builder preview) reflects the revert.
  app.post("/api/chat/:projectId/undo", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!canAccessProject(project, req.session.userId)) return res.status(403).json({ error: "Not your project" });
      const toVersion = Number(req.body?.toVersion);
      if (!Number.isInteger(toVersion) || toVersion < 1) return res.status(400).json({ error: "toVersion must be a positive integer" });
      let version: number;
      try {
        ({ version } = await storage.restoreDocumentVersion(project.id, toVersion));
      } catch (err: any) {
        // restoreDocumentVersion throws Error("no version N for project P") on
        // missing version — that's a 400 (bad client input), not a 500.
        if (typeof err?.message === "string" && err.message.startsWith("no version")) {
          return res.status(400).json({ error: `Version ${toVersion} does not exist` });
        }
        throw err; // unexpected — let the outer catch handle it
      }
      const latest = await storage.getLatestDocument(project.id);
      if (!latest) return res.status(409).json({ error: "Nothing to restore" });
      const html = renderDocumentBody(latest.document);
      const css = renderDocumentCss(latest.document);
      await storage.updateProject(project.id, { html, css });
      return res.json({ ok: true, version, document: latest.document, html, css });
    } catch (error: any) {
      log(`Chat undo error: ${error.message}`);
      return res.status(500).json({ error: "Could not undo" });
    }
  });

  // Quota read for the panel pill — hydrated once on mount and updated from
  // turn_done events. Kept as a separate endpoint so the panel can refresh
  // without waiting for a turn.
  app.get("/api/quota", async (req: Request, res: Response) => {
    try {
      const snap = await quotaSnapshot(req);
      return res.json({ quota: snap.state });
    } catch (error: any) {
      log(`Quota read error: ${error.message}`);
      return res.status(500).json({ error: "Could not read quota" });
    }
  });
}
