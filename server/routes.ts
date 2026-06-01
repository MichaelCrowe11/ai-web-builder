import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generate, generateStream, parseSite, MODEL } from "./ai";
import { rateLimitGenerate } from "./ratelimit";
import { publicUser } from "./plan";
import { hashPassword, verifyPassword, requireAuth } from "./auth";
import { log } from "./index";
import { insertUserSchema, insertProjectSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // AI Generation endpoint
  app.post("/api/generate", rateLimitGenerate, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      log(`Generating website (${MODEL}) for prompt: ${prompt.substring(0, 50)}...`);

      const text = await generate(prompt);
      const result = parseSite(text);

      log("Website generated successfully");
      return res.json({
        html: result.html,
        css: result.css,
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
  app.post("/api/generate/stream", rateLimitGenerate, async (req: Request, res: Response) => {
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
        res.write(`data: ${JSON.stringify({ type: "complete", html: result.html, css: result.css })}\n\n`);
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

      const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${project.css}
  </style>
</head>
<body>
  ${project.html}
</body>
</html>`;

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, '_')}.html"`);
      return res.send(fullHtml);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to export project" });
    }
  });

  return httpServer;
}
