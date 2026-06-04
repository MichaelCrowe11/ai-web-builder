// Machine-discovery surfaces so agents (and x402 directories) find and price the
// service with no human: llms.txt, OpenAPI, /.well-known/x402, /.well-known/agent.json.
import type { Express } from "express";

export function buildDiscovery(prices: { build: number; refine: number }, payTo: string, baseUrl: string) {
  const llmsTxt = `# ai-webbuilder (agent API)
Build and publish a real website from a prompt. Pay per call in USDC over HTTP 402 (x402).

## Endpoints
- POST /v1/agent/sites — build+publish a site. Price: ${prices.build} USDC. Returns { siteUrl, claimToken, document }.
- POST /v1/agent/sites/:id/refine — scoped edit. Price: ${prices.refine} USDC.
- POST /v1/agent/sites/:id/claim — bind ownership with the claimToken. Free.
- GET  /v1/agent/sites/:id — read site status. Free.

## Payment
x402 (scheme "exact", network base, asset USDC), payTo ${payTo}.
Unpaid requests return HTTP 402 with an \`accepts\` payment-requirements array.
`;

  const openapi = {
    openapi: "3.0.0",
    info: { title: "ai-webbuilder agent API", version: "1.0.0" },
    servers: [{ url: baseUrl }],
    paths: {
      "/v1/agent/sites": {
        post: {
          summary: "Build and publish a website (paid via x402)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } } } },
          responses: { "200": { description: "site built" }, "402": { description: "payment required" }, "503": { description: "at capacity / payments unavailable" } },
        },
      },
    },
  };

  const x402 = {
    x402Version: 1,
    payTo,
    network: "base",
    asset: "USDC",
    endpoints: [
      { path: "/v1/agent/sites", method: "POST", priceUsdc: prices.build },
      { path: "/v1/agent/sites/:id/refine", method: "POST", priceUsdc: prices.refine },
    ],
  };

  const agentJson = {
    name: "ai-webbuilder",
    description: "Prompt-to-website builder. Agents pay per call in USDC and get a live site + claim token.",
    capabilities: ["build_site", "refine_site", "claim_site"],
    auth: { type: "x402", network: "base", asset: "USDC" },
    discovery: { openapi: "/openapi.json", llms: "/llms.txt", x402: "/.well-known/x402" },
  };

  return { llmsTxt, openapi, x402, agentJson };
}

export function registerDiscoveryRoutes(app: Express, prices: { build: number; refine: number }, payTo: string) {
  const baseUrl = process.env.APP_URL ?? "https://ai-webbuilder.com";
  const d = buildDiscovery(prices, payTo, baseUrl);
  app.get("/llms.txt", (_req, res) => res.type("text/plain").send(d.llmsTxt));
  app.get("/openapi.json", (_req, res) => res.json(d.openapi));
  app.get("/.well-known/x402", (_req, res) => res.json(d.x402));
  app.get("/.well-known/agent.json", (_req, res) => res.json(d.agentJson));
}
