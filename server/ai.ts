// Site generation, backed by whichever cloud the resolved model chain lands on:
// Cloudflare Workers AI for the @cf/ models Crowe Logic holds funded credit on,
// Azure AI Foundry for Foundry deployments. OpenAI-format REST over plain fetch,
// no SDK. Provider selection and the retry/fallback loop live in ./azure-chat
// and ./providers; this module owns the prompt and the parsing only.

import { azureChat, modelsForTask, type ModelTask } from "./azure-chat";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

// A whole site as JSON is a long answer, and a reasoning model in the chain
// bills its scratchpad against the same budget, so 4096 truncated real pages
// mid-document. Raised, and overridable for a deployment that wants to cap cost.
const MAX_TOKENS = Number(process.env.AI_WEBBUILDER_MAX_TOKENS ?? 8192);

export const SYSTEM_PROMPT = `You are an expert web designer and developer. Generate clean, modern HTML and CSS code based on user prompts.

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

function promptMessages(prompt: string) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Create a website based on this description: ${prompt}` },
  ];
}

/** Extract the {html, css} object from a model response that should be pure JSON. */
export function parseSite(text: string): { html: string; css: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse response as JSON");
  const result = JSON.parse(match[0]);
  return { html: result.html ?? "", css: result.css ?? "" };
}

/** Non-streaming generation. Returns the raw model text (expected to be JSON).
 *  Resilient: retries 429/408/5xx with backoff and falls back across the model chain. */
export async function generate(prompt: string, plan?: string | null): Promise<string> {
  return azureChat(promptMessages(prompt), MAX_TOKENS, {
    endpoint: ENDPOINT,
    apiKey: API_KEY,
    apiVersion: API_VERSION,
    models: modelsForTask("generate", plan),
  });
}

/** Streaming generation. Calls onChunk for each text delta; resolves with the full text.
 *
 *  This used to be a hand-rolled single-shot fetch with its own SSE parser, which
 *  meant the one path a user actually watches was the only path with no retry, no
 *  fallback and no second provider: a single 429 surfaced as a dead stream. It now
 *  runs the same transport as everything else. Deltas are optimistic, so a
 *  mid-stream fallback re-emits; the resolved string is authoritative and callers
 *  should render that as the final answer.
 */
export async function generateStream(
  prompt: string,
  onChunk: (text: string) => void,
  plan?: string | null,
): Promise<string> {
  return azureChat(promptMessages(prompt), MAX_TOKENS, {
    endpoint: ENDPOINT,
    apiKey: API_KEY,
    apiVersion: API_VERSION,
    models: modelsForTask("generate", plan),
    onDelta: onChunk,
  });
}

/** The model a given task and tier leads with, for log lines. */
export function modelLabel(plan?: string | null, task: ModelTask = "generate"): string {
  return modelsForTask(task, plan)[0] ?? "unconfigured";
}

export const MODEL = modelLabel();
