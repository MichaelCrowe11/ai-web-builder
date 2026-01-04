import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./index";

const anthropic = new Anthropic();

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

  return httpServer;
}
