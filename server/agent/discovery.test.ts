import { describe, it, expect } from "vitest";
import { buildDiscovery } from "./discovery";

describe("discovery payloads", () => {
  const d = buildDiscovery({ build: 1, refine: 0.25 }, "0xabc", "https://ai-webbuilder.com");

  it("llms.txt mentions the build endpoint and payment", () => {
    expect(d.llmsTxt).toContain("/v1/agent/sites");
    expect(d.llmsTxt.toLowerCase()).toContain("x402");
  });
  it("openapi declares the build path", () => {
    expect(d.openapi.paths["/v1/agent/sites"]?.post).toBeDefined();
  });
  it(".well-known/x402 lists priced endpoints + payTo", () => {
    expect(d.x402.payTo).toBe("0xabc");
    const build = d.x402.endpoints.find((e) => e.path === "/v1/agent/sites");
    expect(build?.priceUsdc).toBe(1);
  });
  it("agent.json carries name + capabilities", () => {
    expect(d.agentJson.name).toBeTruthy();
    expect(Array.isArray(d.agentJson.capabilities)).toBe(true);
  });
  it("x402.enabled is false when payTo is empty", () => {
    const noWallet = buildDiscovery({ build: 1, refine: 0.25 }, "", "https://x");
    expect(noWallet.x402.enabled).toBe(false);
  });
  it("x402.enabled is true when payTo is set", () => {
    expect(d.x402.enabled).toBe(true);
  });
  it("openapi declares the refine path", () => {
    expect(d.openapi.paths["/v1/agent/sites/{id}/refine"]?.post).toBeDefined();
  });
});
