import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./index";
import { createHash } from "crypto";
import { insertUserSchema, insertProjectSchema } from "@shared/schema";

const anthropic = new Anthropic();

// Simple password hashing (use bcrypt in production)
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

const SYSTEM_PROMPT = `You are an expert web designer and developer. Generate clean, modern HTML and CSS code based on user prompts.

IMPORTANT: You must respond with ONLY valid JSON in this exact format:
{
  "html": "<your HTML code here>",
  "css": "<your CSS code here>"
}

Guidelines:
- Generate semantic, accessible HTML5
- Use modern CSS with CSS variables for theming
- Create visually appealing, professional designs
- Include responsive design patterns
- Use the following CSS variable structure for consistency:
  --primary: (main brand color)
  --text: (text color)
  --bg: (background color)
  --card-bg: (card background)
  --radius: (border radius)
- Include Google Fonts references in CSS (use @import at top)
- Make designs feel premium and polished
- Include hover states and smooth transitions
- DO NOT include <html>, <head>, or <body> tags - only the inner content
- DO NOT include any explanation - ONLY the JSON object`;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // AI Generation endpoint
  app.post("/api/generate", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      log(`Generating website for prompt: ${prompt.substring(0, 50)}...`);

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Create a website based on this description: ${prompt}`,
          },
        ],
        system: SYSTEM_PROMPT,
      });

      const content = message.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      // Parse the JSON response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse response as JSON");
      }

      const result = JSON.parse(jsonMatch[0]);

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
  app.post("/api/generate/stream", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      log(`Streaming generation for: ${prompt.substring(0, 50)}...`);

      const stream = await anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Create a website based on this description: ${prompt}`,
          },
        ],
        system: SYSTEM_PROMPT,
      });

      let fullText = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          fullText += event.delta.text;
          res.write(`data: ${JSON.stringify({ type: "chunk", text: event.delta.text })}\n\n`);
        }
      }

      // Parse final result
      try {
        const jsonMatch = fullText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          res.write(`data: ${JSON.stringify({ type: "complete", html: result.html, css: result.css })}\n\n`);
        }
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

      // Create user with hashed password
      const user = await storage.createUser({
        username,
        password: hashPassword(password),
        email,
      });

      log(`User registered: ${username}`);
      return res.status(201).json({
        id: user.id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        generationsUsed: user.generationsUsed,
        generationsLimit: user.generationsLimit,
      });
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
      if (!user || user.password !== hashPassword(password)) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      log(`User logged in: ${username}`);
      return res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        generationsUsed: user.generationsUsed,
        generationsLimit: user.generationsLimit,
      });
    } catch (error: any) {
      log(`Login error: ${error.message}`);
      return res.status(500).json({ error: "Login failed" });
    }
  });

  // Get user profile
  app.get("/api/auth/user/:id", async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        generationsUsed: user.generationsUsed,
        generationsLimit: user.generationsLimit,
      });
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to get user" });
    }
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
        ...(isPublished !== undefined && { isPublished: String(isPublished) }),
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
