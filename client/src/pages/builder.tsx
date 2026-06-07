import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import type { SectionFlash } from "@/lib/section-flash";
import { JourneyRail, JourneyNudge, type JourneyStep } from "@/components/builder/journey-rail";
import { BillingModal } from "@/components/settings/billing-modal";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft, Download, Rocket, Save, Loader2, ExternalLink, Copy, Wand2, Github, Sparkles, Film, Inbox, Pencil,
} from "lucide-react";
import { GitHubExportModal } from "@/components/builder/github-export-modal";
import { LeadsModal } from "@/components/builder/leads-modal";
import { ContentEditor } from "@/components/builder/content-editor";
import { GenerationOverlay } from "@/components/builder/generation-overlay";
import { renderDocumentBody, renderDocumentCss } from "@shared/renderer";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { postWithCapacityRetry } from "@/lib/generate-fetch";
import { CroweHexC } from "@/components/brand/crowe-hex-c";
import { ChatPanel } from "@/components/builder/chat-panel";

// Clean, modern workspace empty state (rarely seen - arriving from the home
// prompt auto-builds). Crowe gold-on-graphite, clean sans.
const INITIAL_HTML = `<div class="stage"><p class="kicker">Workspace</p><h1>Describe a website to begin.</h1><p class="sub">Type what you want in the bar below — a business, a vibe, a few details — and the workspace builds it live.</p></div>`;
const INITIAL_CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@500&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:grid;place-items:end center;background:#0b0b0c;color:#e8e2cf;font-family:'Inter',system-ui,sans-serif;padding:4rem 2rem 13rem;text-align:center;position:relative}body::before{content:'';position:absolute;inset:0;background:radial-gradient(42rem 26rem at 50% -10%,rgba(191,166,105,0.12),transparent 62%);pointer-events:none}.stage{position:relative;z-index:1;max-width:36rem}.kicker{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.28em;text-transform:uppercase;color:#bfa669;margin-bottom:1.4rem}h1{font-weight:600;font-size:clamp(1.9rem,4.5vw,3rem);line-height:1.08;letter-spacing:-0.03em}.sub{margin:1.2rem auto 0;font-size:1rem;line-height:1.6;color:rgba(232,226,207,0.5);max-width:24rem}`;

// C1/C2 feature flag: side-panel chat. ?chat=1 in any environment, or
// VITE_CHAT_PANEL=1 at build time. Removed when C3 makes the panel default.
// Hoisted to module scope so it's stable before any state is declared and
// so the initial useState for html can branch on it without a condition hook.
// Guard typeof window for SSR safety.
const chatEnabled =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).has("chat") ||
    import.meta.env.VITE_CHAT_PANEL === "1");

// When the chat panel is visible, the empty-state copy points to the panel
// rather than the bottom dock (which is hidden when chatEnabled).
const CHAT_INITIAL_HTML = INITIAL_HTML.replace(
  "in the bar below",
  "in the conversation panel",
);

interface RefineIntent { label: string; instruction: string; }

export default function Builder() {
  const { user } = useAuth();
  const [doc, setDoc] = useState<any | null>(null);
  const [html, setHtml] = useState(chatEnabled ? CHAT_INITIAL_HTML : INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [filling, setFilling] = useState(false);
  const [queued, setQueued] = useState(false);
  const [imaging, setImaging] = useState(false);
  const [videoPct, setVideoPct] = useState<number | null>(null); // null = idle, else rendering %
  const [isSaving, setIsSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled site");
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [sectionFlash, setSectionFlash] = useState<SectionFlash | null>(null);
  const [step, setStep] = useState<JourneyStep>("describe");
  const [refineIntents, setRefineIntents] = useState<RefineIntent[]>([]);
  const [showBilling, setShowBilling] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [showLeads, setShowLeads] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { toast } = useToast();

  // Ref mirrors of `doc` / `projectId` for long-running async flows (pollVideo
  // runs for minutes; handleGenerate spans two requests). Reading these refs
  // avoids stale closures without putting side effects inside state updaters
  // (React updater functions must be pure — they can be re-invoked on rebase).
  const docRef = useRef<any | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const projectIdRef = useRef<string | null>(null);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);

  // Load the tappable refine suggestions once.
  useEffect(() => {
    fetch("/api/refine/intents")
      .then((r) => r.json())
      .then((d) => setRefineIntents(d.intents ?? []))
      .catch(() => {});
  }, []);

  // Handle a 402 paywall response consistently.
  const handlePaywall = (error: any): boolean => {
    if (error?.requiresAuth) { setShowAuth(true); return true; }
    if (error?.requiresUpgrade) { setShowBilling(true); return true; }
    return false;
  };

  // First generation, two-phase: a fast outline paints a themed skeleton in ~2s,
  // then the full document fills in (the user watches it build instead of waiting).
  // Returns true on success so the chat panel's turn-zero path can report
  // failure honestly (errors are toasted here, never thrown).
  const handleGenerate = async (prompt: string): Promise<boolean> => {
    setIsGenerating(true);
    setFilling(false);
    const gate = (status: number, data: any, label: string) => {
      if (status === 402) {
        toast({ title: "You're out of free generations", description: data.details || data.error, variant: "destructive" });
        handlePaywall(data);
        return true;
      }
      if (status >= 400) throw new Error(data.details || data.error || label);
      return false;
    };
    try {
      // Phase 1: outline -> instant themed skeleton.
      const oRes = await postWithCapacityRetry("/api/generate/outline", { prompt }, { onQueued: () => setQueued(true) });
      setQueued(false);
      const oData = await oRes.json();
      if (gate(oRes.status, oData, "Generation failed")) return false;
      setHtml(oData.html);
      setCss(oData.css);
      if (oData.outline?.meta?.name) setProjectName(oData.outline.meta.name);
      setFilling(true); // skeleton is now visible; copy is filling in

      // Phase 2: expand the outline into the full document.
      const fRes = await postWithCapacityRetry("/api/generate/fill", { prompt, outline: oData.outline }, { onQueued: () => setQueued(true) });
      setQueued(false);
      const fData = await fRes.json();
      if (gate(fRes.status, fData, "Generation failed")) return false;
      setDoc(fData.document);
      setHtml(fData.html);
      setCss(fData.css);
      setLastPrompt(prompt);
      if (fData.document?.meta?.name) setProjectName(fData.document.meta.name);
      setStep("refine");
      toast({ title: "Here's your site", description: "Tweak it with a suggestion, or publish." });
      // When the chat panel is active and no project exists yet, silently create
      // one so the panel can start a conversation immediately. Pass the freshly
      // generated document directly to avoid a stale-closure read of `doc` state
      // (setDoc above is async and may not have settled by the time createProject
      // runs within the same synchronous continuation). AWAITED so the panel's
      // `ready` flips before its busy flag clears — otherwise a fast second
      // message could re-route through onFirstMessage and regenerate the site.
      if (chatEnabled && !projectIdRef.current) await createProject(fData.document, prompt);
      // Pro: generate real images in the background (best-effort) and swap them in.
      if (user?.plan === "pro") void generateImages(fData.document);
      return true;
    } catch (error: any) {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
      return false;
    } finally {
      setIsGenerating(false);
      setFilling(false);
      setQueued(false);
    }
  };

  // Pro-only: generate real topical images (~20s each) AFTER the site is shown,
  // then swap them into the document. Best-effort - failures keep gradients.
  const generateImages = async (document: any) => {
    setImaging(true);
    try {
      const res = await fetch("/api/generate/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ document }),
      });
      if (res.ok) {
        const data = await res.json();
        setDoc(data.document);
        setHtml(data.html);
        setCss(data.css);
        toast({ title: "Photos added", description: "Generated images for your site." });
      }
    } catch {
      // best-effort; the site already looks good with gradients
    } finally {
      setImaging(false);
    }
  };

  // Poll an in-progress video render by id and apply the result to the hero
  // when it completes. Used by both the dock path (generateHeroVideo) and the
  // chat path (onVideoStarted prop). After a successful apply, silently persists
  // the updated document so the videoUrl survives a page reload.
  const pollVideo = async (id: string) => {
    try {
      for (let i = 0; i < 80; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        const sd = await (await fetch(`/api/generate/video/status/${id}`, { credentials: "include" })).json();
        if (typeof sd.progress === "number") setVideoPct(sd.progress);
        if (sd.status === "completed") {
          // Read the CURRENT doc via the ref (not the closure — the poll loop
          // runs for minutes and the user may have chatted meanwhile).
          const currentDoc = docRef.current;
          if (currentDoc) {
            const updated = {
              ...currentDoc,
              sections: (currentDoc.sections as any[]).map((s: any) =>
                s.type === "hero" ? { ...s, videoUrl: `/api/video/${id}` } : s,
              ),
            };
            setDoc(updated);
            setHtml(renderDocumentBody(updated as any));
            setCss(renderDocumentCss(updated as any));
            // Silently persist the videoUrl so it survives a page reload.
            const pid = projectIdRef.current;
            if (pid) {
              fetch(`/api/projects/${pid}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ document: updated }),
              }).catch(() => {});
            }
          }
          toast({ title: "Hero video added", description: "A generated background video is on your hero." });
          return;
        }
        if (sd.status === "failed") throw new Error("Video render failed");
      }
      throw new Error("Video timed out");
    } catch (e: any) {
      toast({ title: "Video failed", description: e.message, variant: "destructive" });
    } finally {
      setVideoPct(null);
    }
  };

  // Pro-only: render a Sora hero background video (~1 min), poll, then swap it in
  // (re-rendered client-side via the shared renderer). Free users hit the paywall.
  // Dock path: starts the render then delegates to pollVideo.
  const generateHeroVideo = async () => {
    if (!doc) return;
    const hero = (doc.sections as any[]).find((s) => s.type === "hero");
    const prompt = hero?.imageHint || `${doc.meta?.name ?? "the business"}, a cinematic establishing shot`;
    setVideoPct(0);
    try {
      const r = await fetch("/api/generate/video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.requiresUpgrade) { setShowBilling(true); return; }
        throw new Error(d.error || "Could not start video");
      }
      await pollVideo(d.videoId);
    } catch (e: any) {
      toast({ title: "Video failed", description: e.message, variant: "destructive" });
    } finally {
      // Covers the requiresUpgrade early return too (otherwise videoPct stays
      // at 0 and the dock button reads "Rendering 0%" forever). Redundant after
      // pollVideo's own finally, but setVideoPct(null) is idempotent.
      setVideoPct(null);
    }
  };

  // CMS: persist the owner's edited document (re-render locally, save server-side
  // so the published site reflects it). Creates the project first if needed.
  const saveContent = async (updated: any) => {
    setSavingContent(true);
    setDoc(updated);
    setHtml(renderDocumentBody(updated));
    setCss(renderDocumentCss(updated));
    try {
      let id = projectId;
      if (!id) {
        const r = await fetch("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ html: renderDocumentBody(updated), css: renderDocumentCss(updated), name: updated.meta?.name ?? projectName, prompt: lastPrompt }),
        });
        id = (await r.json()).id;
        setProjectId(id);
      }
      const res = await fetch(`/api/projects/${id}/document`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ document: updated }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      if (updated.meta?.name) setProjectName(updated.meta.name);
      toast({ title: "Saved", description: "Your edits are live on your site." });
      setShowEditor(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingContent(false);
    }
  };

  // Scoped refine: apply an intent to the current document.
  const handleRefine = async (instruction: string) => {
    if (!doc) return;
    setIsGenerating(true);
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ document: doc, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          toast({ title: "You're out of generations", description: data.details || data.error, variant: "destructive" });
          handlePaywall(data);
          return;
        }
        throw new Error(data.details || data.error || "Refine failed");
      }
      setDoc(data.document);
      setHtml(data.html);
      setCss(data.css);
      toast({ title: "Updated", description: "Your change is in." });
    } catch (error: any) {
      toast({ title: "Couldn't apply that", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  // Create a new project and return its id. Accepts a docOverride (plus the
  // prompt) so callers like handleGenerate's turn-zero path can pass the
  // freshly generated doc without relying on stale state closure values —
  // when docOverride is given, html/css/name are derived from IT rather than
  // from state (which hasn't re-rendered into this closure yet).
  const createProject = async (docOverride?: any, promptOverride?: string): Promise<string | null> => {
    const docToSave = docOverride ?? doc;
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          html: docOverride ? renderDocumentBody(docOverride) : html,
          css: docOverride ? renderDocumentCss(docOverride) : css,
          name: docOverride?.meta?.name ?? projectName,
          prompt: promptOverride ?? lastPrompt,
          document: docToSave,
        }),
      });
      const p = await r.json();
      setProjectId(p.id);
      return p.id as string;
    } catch {
      return null;
    }
  };

  const saveProject = useCallback(async () => {
    setIsSaving(true);
    try {
      if (projectId) {
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ html, css, name: projectName, document: doc }),
        });
      } else {
        // createProject swallows its own errors (silent turn-zero path);
        // here a null id must surface as "Save failed", matching pre-refactor
        // behavior where the fetch rejected into this catch.
        if ((await createProject()) === null) throw new Error("Could not create project");
      }
      toast({ title: "Saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, css, doc, projectId, projectName, lastPrompt, toast]);

  const handleExport = useCallback(() => {
    const full = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${projectName}</title><style>${css}</style></head><body>${html}</body></html>`;
    const blob = new Blob([full], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${projectName.replace(/[^a-z0-9]/gi, "_")}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded" });
  }, [html, css, projectName, toast]);

  const handlePublish = useCallback(async () => {
    if (!user) { setShowAuth(true); return; }
    setIsPublishing(true);
    try {
      let id = projectId;
      if (!id) {
        const r = await fetch("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ html, css, name: projectName, prompt: lastPrompt }),
        });
        id = (await r.json()).id; setProjectId(id);
      } else {
        await fetch(`/api/projects/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ html, css, name: projectName }),
        });
      }
      const res = await apiRequest("POST", `/api/projects/${id}/publish`);
      const data = await res.json();
      setPublishedUrl(data.publishedUrl);
      setPreviewUrl(data.previewUrl);
      setStep("done");
      toast({ title: "Your site is live!", description: data.publishedUrl });
    } catch (error: any) {
      const msg = error?.message?.includes("401") ? "Please sign in to publish." : "Could not publish.";
      toast({ title: "Publish failed", description: msg, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [user, projectId, html, css, projectName, lastPrompt, toast]);

  // Arriving from the home prompt (/builder?prompt=...) starts building at once.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (p && p.trim()) {
      window.history.replaceState({}, "", "/builder");
      handleGenerate(p.trim());
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasGenerated = doc !== null;

  return (
    <div className="h-screen flex flex-col bg-graphite font-sans overflow-hidden text-parchment">
      {/* Top bar */}
      <header className="h-16 border-b border-gold/20 flex items-center justify-between px-5 bg-graphite-soft z-10">
        <div className="flex items-center gap-4">
          <Link href="/">
            <button className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/20 text-parchment/70 transition-colors hover:bg-graphite-soft">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex items-center gap-2.5">
            <CroweHexC size={22} />
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="w-44 bg-transparent font-heading text-base font-medium tracking-tight outline-none transition-colors focus:border-b focus:border-gold" />
          </div>
        </div>

        {/* Journey rail — center */}
        <JourneyRail current={step} />

        <div className="flex items-center gap-2">
          {user ? (
            <span className="mr-1 font-mono text-xs text-parchment/55">{user.username}{user.plan === "pro" && <span className="ml-1 font-semibold text-gold">· PRO</span>}</span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowAuth(true)}>Sign in</Button>
          )}
          {user?.plan !== "pro" && (
            <button onClick={() => setShowBilling(true)} className="rounded-full border border-gold px-3 py-1.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/10">Upgrade</button>
          )}
          {/* Utility actions only exist once there's a site to act on — before
              that they'd just clutter the empty state as a row of grey buttons. */}
          {hasGenerated && (
            <>
              <div className="mx-1 h-5 w-px bg-gold/20" />
              <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={saveProject} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={handleExport}>
                <Download className="h-4 w-4" />Export
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={() => setShowGithub(true)}>
                <Github className="h-4 w-4" />GitHub
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={() => setShowLeads(true)}>
                <Inbox className="h-4 w-4" />Leads
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={() => setShowEditor(true)}>
                <Pencil className="h-4 w-4" />Edit
              </Button>
            </>
          )}
          <Button size="sm" className="gap-1.5 rounded-full bg-gold px-5 font-semibold text-graphite transition-all hover:-translate-y-0.5 hover:shadow-[0_0_30px_-8px_rgba(191,166,105,0.7)]" onClick={handlePublish} disabled={isPublishing || !hasGenerated}>
            {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{isPublishing ? "Publishing" : "Publish"}
          </Button>
        </div>
      </header>

      {/* Published banner */}
      {publishedUrl && (
        <div className="flex items-center justify-between border-b border-gold/30 bg-gold/10 px-5 py-2.5 text-sm">
          <div className="flex min-w-0 items-center gap-2 text-gold">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            <span className="shrink-0 font-medium">Live at</span>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer" className="truncate font-mono hover:underline">{publishedUrl}</a>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-gold" onClick={() => { navigator.clipboard?.writeText(publishedUrl); toast({ title: "Copied" }); }}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-gold"><ExternalLink className="h-3.5 w-3.5" /> Visit</Button>
            </a>
          </div>
        </div>
      )}

      {/* Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel: when the flag is on, mount immediately (even pre-generation)
            so the user can type their first message. The panel skips transcript /
            quota fetches while projectId is empty and routes the first message
            through handleGenerate via onFirstMessage instead of the turn endpoint. */}
        {chatEnabled && (
          <ChatPanel
            projectId={projectId ?? ""}
            ready={Boolean(hasGenerated && projectId)}
            onFirstMessage={async (text) => {
              // handleGenerate toasts its own errors and resolves; throw here
              // so the panel patches its stub to the failure copy instead of
              // claiming a draft exists.
              const ok = await handleGenerate(text);
              if (!ok) throw new Error("Generation failed");
            }}
            onDocUpdate={(document, newHtml, newCss) => { setDoc(document); setHtml(newHtml); setCss(newCss); }}
            onQuota={() => {}}
            onVideoStarted={(id) => { setVideoPct(0); void pollVideo(id); }}
            onUpgrade={() => setShowBilling(true)}
            onSectionFlash={setSectionFlash}
          />
        )}
        <div className="relative flex-1 overflow-hidden">
          <PreviewFrame html={html} css={css} device={device} onDeviceChange={setDevice} flash={sectionFlash} />

          {isGenerating && !filling && <GenerationOverlay refining={hasGenerated} queued={queued} />}
          {filling && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gold/25 bg-graphite-soft/90 px-4 py-2 shadow-xl backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-gold" />
              <span className="font-mono text-xs text-parchment/80">Writing your copy…</span>
            </div>
          )}
          {imaging && !filling && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gold/25 bg-graphite-soft/90 px-4 py-2 shadow-xl backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-gold" />
              <span className="font-mono text-xs text-parchment/80">Generating photos…</span>
            </div>
          )}

          {/* Bottom dock: nudge + (refine chips OR prompt). Hidden when the chat
              panel is active — the panel owns all text input in that mode. */}
          {!chatEnabled && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 px-4">
              <div className="pointer-events-auto mx-auto max-w-2xl">
                {/* Nudge only when there's nothing behind it to overlap */}
                {!hasGenerated && (
                  <div className="mb-2 inline-block rounded-full bg-graphite/80 px-4 py-1 backdrop-blur-sm">
                    <JourneyNudge current={step} />
                  </div>
                )}

                {!hasGenerated ? (
                  <PromptInput onGenerate={handleGenerate} isGenerating={isGenerating} />
                ) : (
                  <div className="rounded-2xl border border-gold/25 bg-graphite-soft p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <Wand2 className="h-3.5 w-3.5 text-gold" />
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/55">Refine — tap to apply</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {refineIntents.map((r) => (
                        <button key={r.label} onClick={() => handleRefine(r.instruction)} disabled={isGenerating}
                          className="rounded-full border border-gold/20 bg-graphite-soft px-3 py-1.5 text-sm font-medium text-parchment/85 transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-50">
                          {r.label}
                        </button>
                      ))}
                      <button onClick={generateHeroVideo} disabled={isGenerating || videoPct !== null}
                        className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50">
                        <Film className="h-3.5 w-3.5" />
                        {videoPct !== null ? `Rendering ${videoPct}%` : "Hero video"}
                      </button>
                      <button onClick={() => { setDoc(null); setHtml(INITIAL_HTML); setCss(INITIAL_CSS); setStep("describe"); }}
                        className="rounded-full px-3 py-1.5 text-sm font-medium text-parchment/50 hover:text-parchment/80">
                        Start over
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <BillingModal open={showBilling} onOpenChange={setShowBilling} />
      <AuthModal open={showAuth} onOpenChange={setShowAuth} defaultMode="register" />
      <GitHubExportModal open={showGithub} onOpenChange={setShowGithub} name={projectName} html={html} css={css} />
      <LeadsModal open={showLeads} onOpenChange={setShowLeads} projectId={projectId} />
      <ContentEditor open={showEditor} onOpenChange={setShowEditor} doc={doc} onSave={saveContent} saving={savingContent} />
    </div>
  );
}
