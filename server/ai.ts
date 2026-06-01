// AI generation backed by Crowe Logic's Azure AI Foundry (crowelm-prod-eastus2).
// OpenAI-format REST calls over plain fetch — no SDK dependency, uses our Azure quota.

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const DEPLOYMENT = process.env.AI_WEBBUILDER_MODEL ?? "grok-4-1-fast-non-r";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

// gpt-5 family rejects `max_tokens`/custom temperature and requires `max_completion_tokens`.
const IS_GPT5 = /^gpt-5/i.test(DEPLOYMENT);
const MAX_TOKENS = 4096;

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

function chatUrl(): string {
  if (!ENDPOINT || !API_KEY) {
    throw new Error(
      "Azure Foundry not configured: set AZURE_CORE_ENDPOINT and AZURE_CORE_API_KEY",
    );
  }
  return `${ENDPOINT.replace(/\/$/, "")}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
}

function buildBody(stream: boolean) {
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "Create a website based on this description: " },
    ],
    stream,
  };
  body[IS_GPT5 ? "max_completion_tokens" : "max_tokens"] = MAX_TOKENS;
  if (!IS_GPT5) body.temperature = 0.7;
  return body;
}

function withPrompt(body: Record<string, unknown>, prompt: string) {
  const messages = body.messages as Array<{ role: string; content: string }>;
  messages[1].content = `Create a website based on this description: ${prompt}`;
  return body;
}

/** Extract the {html, css} object from a model response that should be pure JSON. */
export function parseSite(text: string): { html: string; css: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse response as JSON");
  const result = JSON.parse(match[0]);
  return { html: result.html ?? "", css: result.css ?? "" };
}

/** Non-streaming generation. Returns the raw model text (expected to be JSON). */
export async function generate(prompt: string): Promise<string> {
  const res = await fetch(chatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": API_KEY },
    body: JSON.stringify(withPrompt(buildBody(false), prompt)),
  });
  if (!res.ok) {
    throw new Error(`Azure ${DEPLOYMENT} returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Streaming generation. Calls onChunk for each text delta; resolves with the full text. */
export async function generateStream(
  prompt: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch(chatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": API_KEY },
    body: JSON.stringify(withPrompt(buildBody(true), prompt)),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Azure ${DEPLOYMENT} returned ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep incomplete trailing line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        // partial JSON across chunks — ignore, it'll complete next read
      }
    }
  }
  return full;
}

export const MODEL = DEPLOYMENT;
