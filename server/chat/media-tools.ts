// Async service tools for the conversational builder: media generation and
// whole-site rebuild. Pipeline functions are injected so tests run without
// Azure. Pro gating happens HERE (defs are simply absent for free users) and
// is re-asserted by construction: a tool not in defs is never offered to the
// model, and run() still works only for the defs that were built.
import { siteDocumentSchema, type SiteDocument } from "@shared/site-document";
import type { ToolDef } from "../azure-chat";
import { ToolInputError } from "./site-tools";
import type { ServiceTools } from "./agent-loop";

export interface MediaDeps {
  generateSiteImage: (hint: string, orientation?: "landscape" | "portrait") => Promise<string | null>;
  startVideo: (prompt: string) => Promise<string>; // returns videoId; throws if disabled
  rebuildDocument: (prompt: string) => Promise<SiteDocument>;
  onVideoStarted: (videoId: string) => void;
}

// Sections whose schema carries a top-level `image` slot (hero/about/products
// items and gallery are finer-grained; C2 scopes chat images to these two).
const IMAGE_SECTIONS = new Set(["hero", "about"]);

const DEFS: Record<string, ToolDef> = {
  generate_image: { type: "function", function: {
    name: "generate_image",
    description: "Generate a real photo for a section (hero or about) from a short visual hint. Slow (~15s) — use at most 2 per turn, only when the user asks for imagery.",
    parameters: { type: "object", properties: {
      index: { type: "integer", description: "Section index from read_site (hero or about only)" },
      hint: { type: "string", description: "Concrete photographable subject, 2-6 words" },
    }, required: ["index", "hint"] },
  } },
  start_hero_video: { type: "function", function: {
    name: "start_hero_video",
    description: "Start rendering a cinematic background video for the hero. Rendering takes minutes and continues after this conversation turn — tell the user it is on its way.",
    parameters: { type: "object", properties: {
      prompt: { type: "string", description: "Visual description; defaults to the hero imageHint" },
    } },
  } },
  rebuild_site: { type: "function", function: {
    name: "rebuild_site",
    description: "Regenerate the ENTIRE site from a new description. Destructive — only when the user explicitly asks to start over or change what the business is.",
    parameters: { type: "object", properties: {
      prompt: { type: "string", description: "The new business description" },
    }, required: ["prompt"] },
  } },
};

export function buildServiceTools(isPro: boolean, deps: MediaDeps): ServiceTools {
  const names = isPro ? ["generate_image", "start_hero_video", "rebuild_site"] : ["rebuild_site"];
  const defs = names.map((n) => DEFS[n]);
  const allowed = new Set(names);

  return {
    defs,
    async run(doc, name, args) {
      if (!allowed.has(name)) throw new ToolInputError(`unknown tool: ${name}`);

      if (name === "generate_image") {
        const i = args?.index;
        const section: any = typeof i === "number" ? doc.sections[i] : undefined;
        if (!section) throw new ToolInputError(`index must be 0..${doc.sections.length - 1}`);
        if (!IMAGE_SECTIONS.has(section.type)) {
          throw new ToolInputError(`section ${i} is a ${section.type}; photos can go on hero or about sections`);
        }
        const hint = typeof args?.hint === "string" && args.hint.trim() ? args.hint.trim() : section.imageHint;
        if (!hint) throw new ToolInputError("provide a short visual hint for the photo");
        const url = await deps.generateSiteImage(hint, "landscape");
        if (!url) throw new ToolInputError("the photo could not be generated right now; tell the user and move on");
        const sections = doc.sections.slice();
        sections[i] = { ...section, image: { url, alt: hint } };
        const next = siteDocumentSchema.parse({ ...doc, sections });
        return { doc: next, result: { ok: true, index: i, alt: hint }, mutated: true };
      }

      if (name === "start_hero_video") {
        const hero: any = doc.sections.find((s: any) => s.type === "hero");
        const prompt = (typeof args?.prompt === "string" && args.prompt.trim())
          || hero?.imageHint
          || `${doc.meta?.name ?? "the business"}, a cinematic establishing shot`;
        const videoId = await deps.startVideo(prompt as string);
        deps.onVideoStarted(videoId);
        return { doc, result: { status: "rendering", videoId, note: "takes a few minutes; it will appear on the hero automatically" }, mutated: false };
      }

      // rebuild_site
      const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) throw new ToolInputError("rebuild_site needs the new business description");
      const next = await deps.rebuildDocument(prompt);
      return { doc: next, result: { ok: true, name: next.meta.name }, mutated: true };
    },
  };
}
