# Conversational Builder C2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase C2 of the conversational builder (spec: `docs/superpowers/specs/2026-06-06-conversational-builder-design.md`): media tools (Pro-gated), `rebuild_site`, undo, the quota pill, and the turn-zero flow that retires the bottom dock — all still behind the `?chat=1` flag.

**Architecture:** The C1 agent loop gains an injected **serviceTools** map for async tools (media + rebuild) so `site-tools.ts` stays pure/sync. The route injects implementations built on the existing pipelines (`generateSiteImage`, `startVideo`, `generateDocument`+`resolveDocumentImages`) and gates media defs on the user's plan. Hero video doesn't fit a 60s turn: the tool only STARTS the render and the route emits a `video_started` SSE event; the client polls the existing status endpoint and applies `videoUrl` on completion. Undo is a thin route over the existing `restoreDocumentVersion`. Turn-zero routes the first message client-side through the existing two-phase generate + auto-save, then hands the conversation to the turn endpoint; when the flag is on, the bottom dock does not render.

**Tech Stack:** unchanged from C1 (Express+SSE, zod, vitest with injected fakes, React/Tailwind).

**Branch:** continue on `feat/conversational-builder-c1` (all dark behind the flag; one PR for the whole feature).

---

### Task 1: serviceTools support in the agent loop

**Files:**
- Modify: `server/chat/agent-loop.ts`
- Test: `server/chat/agent-loop.test.ts` (append)

Async tools the loop awaits, injected per-turn so tests fake them and the route owns the real implementations.

- [ ] **Step 1: failing tests** (append):

```ts
  it("dispatches a serviceTool, awaits it, and treats its outcome like applyTool's", async () => {
    const { fn } = scripted([
      toolCall("c1", "generate_image", { index: 0, hint: "sourdough loaf" }),
      finalText("Added a photo."),
    ]);
    const { events, onEvent } = collectEvents();
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "photo on the hero",
      allowMutations: true, chatFn: fn, onEvent,
      serviceTools: {
        defs: [{ type: "function", function: { name: "generate_image", description: "x", parameters: { type: "object", properties: {} } } }],
        run: async (doc, name, args) => ({
          doc: { ...doc, sections: doc.sections.map((s: any, i: number) => i === args.index ? { ...s, image: { url: "data:image/jpeg;base64,x", alt: args.hint } } : s) } as any,
          result: { ok: true }, mutated: true,
        }),
      },
    });
    expect(out.mutated).toBe(true);
    expect((out.doc.sections[0] as any).image.alt).toBe("sourdough loaf");
    expect(events.filter((e) => e.type === "doc_updated")).toHaveLength(1);
  });

  it("a serviceTool rejection is fed back as a tool error, not a crash", async () => {
    const { fn, calls } = scripted([
      toolCall("c1", "generate_image", { index: 0, hint: "x" }),
      finalText("Couldn't generate that image."),
    ]);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "photo", allowMutations: true,
      chatFn: fn, onEvent: () => {},
      serviceTools: {
        defs: [{ type: "function", function: { name: "generate_image", description: "x", parameters: { type: "object", properties: {} } } }],
        run: async () => { throw new ToolInputError("image generation is unavailable right now"); },
      },
    });
    expect(out.mutated).toBe(false);
    const toolMsg = calls[1].filter((m: any) => m.role === "tool")[0];
    expect(toolMsg.content).toMatch(/unavailable/);
  });
```

Import `ToolInputError` from `./site-tools` in the test file.

- [ ] **Step 2:** run — FAIL (serviceTools not an option).

- [ ] **Step 3: implement.** In `agent-loop.ts`:

```ts
export interface ServiceTools {
  defs: ToolDef[];
  // Async tools (media, rebuild). Throw ToolInputError for model-correctable
  // failures; anything else propagates like applyTool's non-input errors.
  run: (doc: SiteDocument, name: string, args: any) => Promise<{ doc: SiteDocument; result: unknown; mutated: boolean }>;
}
```

`RunTurnOpts` gains `serviceTools?: ServiceTools`. In `runTurn`:
- tools list becomes `[...base, ...(serviceTools?.defs ?? [])]` where `base` is the existing allowMutations-filtered TOOL_DEFS (service defs are pre-gated by the caller — the route only passes what the user may use).
- a `const serviceNames = new Set(serviceTools?.defs.map((d) => d.function.name) ?? [])`.
- in the per-call execution, replace the direct `applyTool` call with:

```ts
        const out = serviceNames.has(call.name)
          ? await serviceTools!.run(doc, call.name, args)
          : applyTool(doc, call.name, args);
```

Everything else (two-strike, cap, events, labels) applies unchanged. Add service labels to `toolLabel`: `generate_image` → `Generating a photo — ${args?.hint ?? ""}`, `start_hero_video` → `"Starting the hero video"`, `rebuild_site` → `"Rebuilding the site"` (default case already returns name for unknowns).

- [ ] **Step 4:** `npx vitest run server/chat/agent-loop.test.ts` (12 pass) + full suite + `npm run check`.

- [ ] **Step 5: Commit** `feat(chat): serviceTools — injected async tools in the agent loop`

---

### Task 2: media + rebuild service tools

**Files:**
- Create: `server/chat/media-tools.ts`
- Test: `server/chat/media-tools.test.ts`

Real implementations over existing pipelines, with the pipeline functions injectable for tests.

- [ ] **Step 1: failing tests**:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildServiceTools } from "./media-tools";
import { ToolInputError } from "./site-tools";
import { fixtureDoc } from "./fixtures";

const deps = () => ({
  generateSiteImage: vi.fn(async (hint: string) => `data:image/jpeg;base64,FAKE-${hint}`),
  startVideo: vi.fn(async () => "vid-123"),
  rebuildDocument: vi.fn(async (prompt: string) => ({ ...fixtureDoc(), meta: { ...fixtureDoc().meta, name: `Rebuilt: ${prompt}` } })),
  onVideoStarted: vi.fn(),
});

describe("buildServiceTools", () => {
  it("pro user gets all three defs; free user gets only rebuild_site", () => {
    const d = deps();
    expect(buildServiceTools(true, d).defs.map((t) => t.function.name).sort())
      .toEqual(["generate_image", "rebuild_site", "start_hero_video"]);
    expect(buildServiceTools(false, d).defs.map((t) => t.function.name))
      .toEqual(["rebuild_site"]);
  });

  it("generate_image attaches the image to the indexed section", async () => {
    const d = deps();
    const tools = buildServiceTools(true, d);
    const out = await tools.run(fixtureDoc(), "generate_image", { index: 1, hint: "baker at dawn" });
    expect((out.doc.sections[1] as any).image.url).toContain("FAKE-baker at dawn");
    expect(out.mutated).toBe(true);
  });

  it("generate_image rejects a section that has no image slot", async () => {
    const d = deps();
    const tools = buildServiceTools(true, d);
    // contact (index 2 in the fixture) has no image field in the schema
    await expect(tools.run(fixtureDoc(), "generate_image", { index: 2, hint: "x" })).rejects.toThrow(ToolInputError);
  });

  it("generate_image surfaces pipeline failure as a model-correctable error", async () => {
    const d = { ...deps(), generateSiteImage: vi.fn(async () => null) };
    const tools = buildServiceTools(true, d);
    await expect(tools.run(fixtureDoc(), "generate_image", { index: 0, hint: "x" })).rejects.toThrow(/could not be generated/);
  });

  it("start_hero_video starts the render, notifies, and does NOT mutate the doc", async () => {
    const d = deps();
    const tools = buildServiceTools(true, d);
    const out = await tools.run(fixtureDoc(), "start_hero_video", { prompt: "bakery at golden hour" });
    expect(d.startVideo).toHaveBeenCalled();
    expect(d.onVideoStarted).toHaveBeenCalledWith("vid-123");
    expect(out.mutated).toBe(false);
    expect((out.result as any).status).toBe("rendering");
  });

  it("rebuild_site replaces the whole document", async () => {
    const d = deps();
    const tools = buildServiceTools(false, d);
    const out = await tools.run(fixtureDoc(), "rebuild_site", { prompt: "a coffee truck in Tempe" });
    expect(out.doc.meta.name).toBe("Rebuilt: a coffee truck in Tempe");
    expect(out.mutated).toBe(true);
  });

  it("unknown service tool throws ToolInputError", async () => {
    const d = deps();
    await expect(buildServiceTools(true, d).run(fixtureDoc(), "explode", {})).rejects.toThrow(ToolInputError);
  });
});
```

- [ ] **Step 2:** run — FAIL.

- [ ] **Step 3: implement** `server/chat/media-tools.ts`:

```ts
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
```

NOTE: if `startVideo`'s real signature (server/azure-video.ts:29) takes more params, the route adapts at injection time — keep MediaDeps minimal. If a pipeline failure should NOT be ToolInputError per the loop's contract, it is correct as written: ToolInputError = model-correctable, which "tell the user and move on" is.

- [ ] **Step 4:** run tests (7 pass) + full suite + `npm run check`.

- [ ] **Step 5: Commit** `feat(chat): media + rebuild service tools, Pro-gated by def inclusion`

---

### Task 3: route wiring — service tools, video_started, undo, GET /api/quota

**Files:**
- Modify: `server/chat/routes.ts`
- Test: `server/chat/routes.test.ts` (append where pure)

- [ ] **Step 1: implement** (TDD where pure; the route body is covered by the Task 6 smoke):

In `registerChatRoutes`:

a) **Service tools injection** — inside the POST turn handler, after `quota` is known:

```ts
    const isPro = quota.user?.plan === "pro";
    const serviceTools = buildServiceTools(isPro, {
      generateSiteImage,
      startVideo: (prompt) => startVideo(prompt).then((r) => { /* adapt to actual return shape; throw if videoEnabled() is false */ return r; }),
      rebuildDocument: async (prompt) => {
        const raw = await runLimited(() => generateDocument(prompt));
        return resolveDocumentImages(raw, stockOpts());
      },
      onVideoStarted: (videoId) => send("video_started", { videoId }),
    });
```

READ `server/azure-video.ts` `startVideo` and `server/routes.ts`'s `/api/generate/video/start` handler first: mirror exactly how the existing route calls it (params, videoEnabled() guard, return field for the id) and how `stockOpts` is built in routes.ts (copy the tiny helper or import `resolveDocumentImages` with env opts the same way). The video tool must throw `ToolInputError("video rendering is not available right now")` when `videoEnabled()` is false. Pass `serviceTools` to `runTurn`.

CAUTION on ordering: `send` does not exist until after `writeHead` — construct `serviceTools` AFTER the `send` const (it closes over `send`).

b) **Undo route**:

```ts
  // Revert to a prior document version (the undo affordance in the panel).
  // restoreDocumentVersion writes the restored doc as a NEW version, so undo
  // is itself undoable.
  app.post("/api/chat/:projectId/undo", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!canAccessProject(project, req.session.userId)) return res.status(403).json({ error: "Not your project" });
      const toVersion = Number(req.body?.toVersion);
      if (!Number.isInteger(toVersion) || toVersion < 1) return res.status(400).json({ error: "toVersion must be a positive integer" });
      const { version } = await storage.restoreDocumentVersion(project.id, toVersion);
      const latest = await storage.getLatestDocument(project.id);
      if (!latest) return res.status(409).json({ error: "Nothing to restore" });
      const html = renderDocumentBody(latest.document);
      const css = renderDocumentCss(latest.document);
      await storage.updateProject(project.id, { html, css });
      return res.json({ ok: true, version, document: latest.document, html, css });
    } catch (error: any) {
      log(`Chat undo error: ${error.message}`);
      return res.status(500).json({ error: "Could not undo" });
    }
  });
```

READ storage's `restoreDocumentVersion` to confirm it throws vs returns on a missing version; map a missing-version failure to 400/409 (not 500) if distinguishable.

c) **GET /api/quota** (panel pill hydration; same handler style, try/catch):

```ts
  app.get("/api/quota", async (req: Request, res: Response) => {
    try {
      const snap = await quotaSnapshot(req);
      return res.json({ quota: snap.state });
    } catch (error: any) {
      log(`Quota read error: ${error.message}`);
      return res.status(500).json({ error: "Could not read quota" });
    }
  });
```

d) Append pure tests where possible (e.g. none of the above is pure — acceptable; note it). Run full suite + `npm run check`.

- [ ] **Step 2: Commit** `feat(chat): wire media/rebuild tools, video_started event, undo route, quota read`

---

### Task 4: panel — quota pill, undo footer, video_started

**Files:**
- Modify: `client/src/components/builder/chat-panel.tsx`

- [ ] **Step 1: implement:**

a) **Quota pill:** `const [quota, setQuota] = useState<any | null>(null);` hydrate once via `fetch("/api/quota")` (same .catch(() => {}) style); update from `turn_done` (replace the `onQuota` prop usage — keep calling `onQuota` too). Header right side: when `quota?.limit != null` render `<span className="rounded-full border border-gold/30 px-2.5 py-0.5 font-mono text-[10px] text-gold">{quota.used} / {quota.limit} today</span>`; when `limit === null` render the same pill with `Unlimited`.

b) **Undo footer:** messages need `docVersion` — extend `ChatMsg` with `docVersion?: number | null`, map it in hydration AND set it on the live assistant message from `turn_done.docVersion`. Under an assistant message with a number `docVersion > 1`, render:

```tsx
<button onClick={() => undo(m.docVersion! - 1)} className="mt-1.5 font-mono text-[10.5px] text-parchment/45 hover:text-gold">
  v{m.docVersion! - 1} → v{m.docVersion} · undo
</button>
```

`undo(toVersion)`: POST `/api/chat/${projectId}/undo` with `{toVersion}`; on ok → `onDocUpdate(d.document, d.html, d.css)` and append a transcript-local assistant note `{role:"assistant", content:"Reverted to the previous version."}`. Disable while `busy`.

c) **video_started:** new prop `onVideoStarted?: (videoId: string) => void`; in the SSE loop add `else if (event === "video_started") { onVideoStarted?.(data.videoId); }`.

- [ ] **Step 2:** `npm run check` + full suite green.

- [ ] **Step 3: Commit** `feat(chat): quota pill, undo affordance, video_started passthrough in the panel`

---

### Task 5: builder — turn-zero flow, dock retirement (flag-on), video polling reuse

**Files:**
- Modify: `client/src/pages/builder.tsx`
- Modify: `client/src/components/builder/chat-panel.tsx` (first-message routing)

- [ ] **Step 1: builder changes:**

a) **Extract video polling:** refactor `generateHeroVideo` into `pollVideo(id: string)` (the loop from the status-poll down through applying `videoUrl` + toast; keep `generateHeroVideo` as `startVideo→pollVideo` for the dock path which still exists when the flag is off). Pass `onVideoStarted={(id) => { setVideoPct(0); void pollVideo(id); }}` to ChatPanel. After the video applies, ALSO fire a silent save (`PATCH` with document) so the videoUrl persists — reuse `saveProject`.

b) **Auto-save after generation when chat is on:** at the end of `handleGenerate`'s success path, when `chatEnabled && !projectId`, silently create the project (extract the POST block of `saveProject` into `createProject(): Promise<string|null>` that returns the id and sets state; `saveProject` reuses it). No toast for the silent path.

c) **Turn-zero panel:** when `chatEnabled`, render ChatPanel whenever the flag is on (drop the `hasGenerated && projectId` gate) and pass two new props: `ready={Boolean(hasGenerated && projectId)}` and `onFirstMessage={async (text) => { await handleGenerate(text); }}`. Hide the entire bottom dock when `chatEnabled` (the `{/* Bottom dock */}` block renders only when `!chatEnabled`). The pre-generation iframe empty state copy: change `INITIAL_HTML`'s sub copy to a chat-aware variant ONLY when flagged — simplest: add `const CHAT_INITIAL_HTML = INITIAL_HTML.replace("in the bar below", "in the conversation panel")` and pass it to the initial `useState(chatEnabled ? CHAT_INITIAL_HTML : INITIAL_HTML)`. (Flag is read before first render — hoist `chatEnabled` computation above the state declarations to module scope or a function; it reads `window.location` so a module-level `const` in the component file is fine.)

- [ ] **Step 2: panel first-message routing:** new props `ready: boolean` and `onFirstMessage?: (text: string) => Promise<void>`. In `send()`: when `!ready && onFirstMessage`, instead of POSTing a turn: append the user message + an assistant stub "Building your site — watch the preview…", call `await onFirstMessage(message)`, then patch the stub to "Here's the first draft. Tell me what to change." (catch → patch failure text). These turn-zero exchanges are client-side only (not persisted — the transcript starts at the first real turn; acceptable C2 gap, noted in the plan). Empty-state hint copy becomes "Describe the site you want — the builder does the rest."

- [ ] **Step 3:** `npm run check` + suite. Manually eyeball nothing yet (Task 6 smokes).

- [ ] **Step 4: Commit** `feat(chat): turn-zero conversation, dock retired behind flag, video polling via chat`

---

### Task 6: e2e smoke (controller-driven)

No files. With the dev server restarted on this branch, in a browser at `/builder?chat=1`:

1. **Turn-zero:** panel visible immediately, dock absent; first message ("a florist in Tempe called Stem & Co") generates the site in the preview; panel hands off to conversation.
2. **Conversation:** "punchier hero headline" → chips + preview update + quota pill decrements.
3. **Undo:** footer appears on the mutating message; click → preview reverts; transcript notes it.
4. **Rebuild (free path):** "actually make it a coffee truck called Drip City" → rebuild_site runs, whole site swaps.
5. **Media gating (free user):** "generate a photo for the hero" → agent declines politely with upgrade nudge (no generate_image def for free).
6. Full suite + tsc one final time; push.

---

## Notes

- **Prompt fix folded into Task 1:** add to the system prompt rules: `- move_section's "to" is the section's FINAL index after the move.` and clarify the user-visible behavior the C1 smoke flagged (testimonials placed above hero on "right after the hero").
- The migration from C1 (`script/chat-migration.sql`) still gates any prod deploy; C2 adds no schema.
- Turn-zero exchanges aren't persisted server-side (C3: persist via the turn endpoint once generation moves server-side behind `rebuild_site`).
