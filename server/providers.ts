// Where a model actually lives.
//
// The chat transport used to assume every model was an Azure Foundry deployment:
// one base URL, one `api-key` header. Crowe Logic now runs models on two clouds,
// so the transport asks this module where each model in the fallback chain goes
// and gets back a fully-formed request target, or null when that provider has no
// credentials in this environment.
//
// Returning null rather than throwing is deliberate. A chain is allowed to name
// models the current environment cannot reach; those are skipped and the next
// one is tried. That is what lets a single chain span both clouds and still boot
// on a box that only has one of them configured.
//
//   "@cf/..."  -> Cloudflare Workers AI, OpenAI-compatible surface
//   anything else -> Azure AI Foundry deployment
//
// Both surfaces speak the OpenAI wire format, so the retry, fallback and SSE
// machinery upstream is provider-agnostic and stays untouched.

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
}

export interface ProviderTarget {
  url: string;
  headers: Record<string, string>;
  /** Cloudflare needs the model named in the body; Azure encodes it in the URL. */
  bodyModel?: string;
  /** Which cloud served this, for log lines and error messages. */
  provider: "azure" | "cloudflare";
}

/** Cloudflare Workers AI model ids are namespaced, e.g. @cf/zai-org/glm-5.2. */
export function isCloudflareModel(model: string): boolean {
  return model.startsWith("@cf/");
}

function cloudflareTarget(model: string): ProviderTarget | null {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  // CLOUDFLARE_API_TOKEN is the conventional name; CLOUDFLARE_API_KEY is what
  // the Crowe estate exports, so accept either rather than making the estate
  // rename a variable that a dozen other tools already read.
  const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_KEY ?? "";
  if (!account || !token) return null;
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    bodyModel: model,
    provider: "cloudflare",
  };
}

function azureTarget(model: string, cfg: AzureConfig): ProviderTarget | null {
  if (!cfg.endpoint || !cfg.apiKey) return null;
  return {
    url: `${cfg.endpoint.replace(/\/$/, "")}/openai/deployments/${model}/chat/completions?api-version=${cfg.apiVersion}`,
    headers: { "Content-Type": "application/json", "api-key": cfg.apiKey },
    provider: "azure",
  };
}

/** Resolve one model to a request target, or null when its cloud is unconfigured. */
export function resolveTarget(model: string, azure: AzureConfig): ProviderTarget | null {
  return isCloudflareModel(model) ? cloudflareTarget(model) : azureTarget(model, azure);
}
