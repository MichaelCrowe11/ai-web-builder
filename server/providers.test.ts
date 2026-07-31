import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTarget, isCloudflareModel } from "./providers";

const azure = {
  endpoint: "https://foundry.example.com",
  apiKey: "azure-key",
  apiVersion: "2024-12-01-preview",
};

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_API_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("isCloudflareModel", () => {
  it("recognises the @cf/ namespace and nothing else", () => {
    expect(isCloudflareModel("@cf/zai-org/glm-5.2")).toBe(true);
    expect(isCloudflareModel("@cf/moonshotai/kimi-k2.7-code")).toBe(true);
    expect(isCloudflareModel("gpt-4o")).toBe(false);
    expect(isCloudflareModel("DeepSeek-V4-Flash")).toBe(false);
    // A deployment merely containing the marker is still an Azure deployment.
    expect(isCloudflareModel("my-@cf/-deployment")).toBe(false);
  });
});

describe("resolveTarget: Cloudflare", () => {
  it("builds the OpenAI-compatible URL and names the model in the body", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_API_TOKEN = "cf-token";
    const t = resolveTarget("@cf/zai-org/glm-5.2", azure)!;
    expect(t.provider).toBe("cloudflare");
    expect(t.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1/chat/completions",
    );
    expect(t.headers.Authorization).toBe("Bearer cf-token");
    // Cloudflare does not encode the model in the path, so it must ride in the body.
    expect(t.bodyModel).toBe("@cf/zai-org/glm-5.2");
  });

  it("accepts CLOUDFLARE_API_KEY as the token, which is what the estate exports", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_API_KEY = "estate-key";
    expect(resolveTarget("@cf/moonshotai/kimi-k2.7-code", azure)!.headers.Authorization).toBe(
      "Bearer estate-key",
    );
  });

  it("prefers CLOUDFLARE_API_TOKEN when both are set", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    process.env.CLOUDFLARE_API_TOKEN = "preferred";
    process.env.CLOUDFLARE_API_KEY = "fallback";
    expect(resolveTarget("@cf/zai-org/glm-5.2", azure)!.headers.Authorization).toBe(
      "Bearer preferred",
    );
  });

  it("is unreachable, not fatal, when the account or token is missing", () => {
    expect(resolveTarget("@cf/zai-org/glm-5.2", azure)).toBeNull();
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123"; // token still absent
    expect(resolveTarget("@cf/zai-org/glm-5.2", azure)).toBeNull();
  });
});

describe("resolveTarget: Azure", () => {
  it("encodes the deployment in the path and authenticates with api-key", () => {
    const t = resolveTarget("gpt-4o", azure)!;
    expect(t.provider).toBe("azure");
    expect(t.url).toBe(
      "https://foundry.example.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-12-01-preview",
    );
    expect(t.headers["api-key"]).toBe("azure-key");
    // Azure rejects a body model that disagrees with the deployment in the path.
    expect(t.bodyModel).toBeUndefined();
  });

  it("does not double the slash when the endpoint has a trailing one", () => {
    const t = resolveTarget("gpt-4o", { ...azure, endpoint: "https://foundry.example.com/" })!;
    expect(t.url).toContain("https://foundry.example.com/openai/deployments/");
  });

  it("is unreachable, not fatal, when Azure is unconfigured", () => {
    expect(resolveTarget("gpt-4o", { ...azure, endpoint: "" })).toBeNull();
    expect(resolveTarget("gpt-4o", { ...azure, apiKey: "" })).toBeNull();
  });
});
