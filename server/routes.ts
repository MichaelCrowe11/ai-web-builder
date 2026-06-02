import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generate, generateStream, parseSite, MODEL } from "./ai";
import { generateDocument, refineDocument, REFINE_INTENTS } from "./document-gen";
import { renderDocumentBody, renderDocumentCss } from "./renderer";
import { siteDocumentSchema } from "@shared/site-document";
import { enforceQuota, consumeGeneration } from "./quota";
import { publicUser } from "./plan";
import { hashPassword, verifyPassword, requireAuth } from "./auth";
import { registerBillingRoutes } from "./billing";
import { registerPublishRoutes, renderFullHtml } from "./publish";
import { registerGrowthRoutes } from "./growth-routes";
import { log } from "./index";
import { insertUserSchema, insertProjectSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Billing routes (Stripe checkout + portal)
  registerBillingRoutes(app);

  // Publishing routes (publish/unpublish + /s/:slug serving)
  registerPublishRoutes(app);

  // Growth routes (telemetry sink + Mission Control API)
  registerGrowthRoutes(app);

  // List of tappable refine intents for the UI.
  app.get("/api/refine/intents", (_req: Request, res: Response) => {
    return res.json({ intents: REFINE_INTENTS });
  });

  // STRUCTURED generation: prompt -> validated Site Document -> rendered HTML/CSS.
  // The AI never writes markup, so output can't be broken or unsafe.
  app.post("/api/generate/document", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      log(`Generating document (${MODEL}) for: ${prompt.substring(0, 50)}...`);
      const document = await generateDocument(prompt);
      const quota = await consumeGeneration(req);
      return res.json({
        document,
        html: renderDocumentBody(document),
        css: renderDocumentCss(document),
        quota,
      });
    } catch (error: any) {
      log(`Document generation error: ${error.message}`);
      return res.status(500).json({ error: "Failed to generate site", details: error.message });
    }
  });

  // SCOPED refine: apply an instruction to an existing document. Counts as a
  // generation against quota (it's an Azure call), but it's targeted + cheap.
  app.post("/api/refine", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { document, instruction } = req.body;
      if (!instruction || typeof instruction !== "string") {
        return res.status(400).json({ error: "Instruction is required" });
      }
      const parsed = siteDocumentSchema.safeParse(document);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid document is required" });
      }
      log(`Refining document: ${instruction.substring(0, 50)}...`);
      const updated = await refineDocument(parsed.data, instruction);
      const quota = await consumeGeneration(req);
      return res.json({
        document: updated,
        html: renderDocumentBody(updated),
        css: renderDocumentCss(updated),
        quota,
      });
    } catch (error: any) {
      log(`Refine error: ${error.message}`);
      return res.status(500).json({ error: "Failed to refine site", details: error.message });
    }
  });

  // AI Generation endpoint (legacy raw HTML/CSS — kept during transition)
  app.post("/api/generate", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      log(`Generating website (${MODEL}) for prompt: ${prompt.substring(0, 50)}...`);

      const text = await generate(prompt);
      const result = parseSite(text);

      // Count this generation against the user's quota only on success.
      const quota = await consumeGeneration(req);

      log("Website generated successfully");
      return res.json({
        html: result.html,
        css: result.css,
        quota,
      });
    } catch (error: any) {
      log(`Generation error: ${error.message}`);
      return res.status(500).json({
        error: "Failed to generate website",
        details: error.message
      });
    }
  });

  // Streaming generation endpoint for real-time feedback
  app.post("/api/generate/stream", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      log(`Streaming generation (${MODEL}) for: ${prompt.substring(0, 50)}...`);

      const fullText = await generateStream(prompt, (text) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
      });

      // Parse final result
      try {
        const result = parseSite(fullText);
        const quota = await consumeGeneration(req);
        res.write(`data: ${JSON.stringify({ type: "complete", html: result.html, css: result.css, quota })}\n\n`);
      } catch (parseError) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to parse response" })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      log(`Stream error: ${error.message}`);
      res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
      res.end();
    }
  });

  // ============ AUTHENTICATION ROUTES ============

  // Register new user
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parseResult = insertUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid input", details: parseResult.error.errors });
      }

      const { username, password, email } = parseResult.data;

      // Check if user exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: "Username already taken" });
      }

      // Create user with bcrypt-hashed password
      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
        email,
      });

      req.session.userId = user.id;
      log(`User registered: ${username}`);
      return res.status(201).json(publicUser(user));
    } catch (error: any) {
      log(`Registration error: ${error.message}`);
      return res.status(500).json({ error: "Registration failed" });
    }
  });

  // Login user
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.userId = user.id;
      log(`User logged in: ${username}`);
      return res.json(publicUser(user));
    } catch (error: any) {
      log(`Login error: ${error.message}`);
      return res.status(500).json({ error: "Login failed" });
    }
  });

  // Current authenticated user (from session)
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      // Stale session pointing at a deleted user — clear it.
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.json(publicUser(user));
  });

  // Logout: destroy session + clear cookie
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  });

  // ============ PROJECT ROUTES ============

  // Create a new project
  app.post("/api/projects", async (req: Request, res: Response) => {
    try {
      const { userId, name, html, css, prompt } = req.body;

      if (!html || !css) {
        return res.status(400).json({ error: "HTML and CSS are required" });
      }

      const project = await storage.createProject({
        userId: userId || null,
        name: name || "Untitled Project",
        html,
        css,
        prompt: prompt || null,
      });

      log(`Project created: ${project.id}`);
      return res.status(201).json(project);
    } catch (error: any) {
      log(`Project creation error: ${error.message}`);
      return res.status(500).json({ error: "Failed to create project" });
    }
  });

  // Get a specific project
  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      return res.json(project);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to get project" });
    }
  });

  // Get all projects for a user
  app.get("/api/users/:userId/projects", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getProjectsByUser(req.params.userId);
      return res.json(projects);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to get projects" });
    }
  });

  // Update a project
  app.patch("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const { name, html, css, isPublished } = req.body;
      const project = await storage.updateProject(req.params.id, {
        ...(name && { name }),
        ...(html && { html }),
        ...(css && { css }),
        ...(isPublished !== undefined && { isPublished: Boolean(isPublished) }),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      log(`Project updated: ${project.id}`);
      return res.json(project);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to update project" });
    }
  });

  // Delete a project
  app.delete("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteProject(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Project not found" });
      }
      log(`Project deleted: ${req.params.id}`);
      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // Export project as downloadable HTML file
  app.get("/api/projects/:id/export", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const fullHtml = renderFullHtml(project);

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, '_')}.html"`);
      return res.send(fullHtml);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to export project" });
    }
  });

  return httpServer;
}
