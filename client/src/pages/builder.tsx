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
  ArrowLeft, Download, Rocket, Save, Loader2, ExternalLink, Copy, Wand2, Github, Film, Inbox, Pencil,
} from "lucide-react";
import { GitHubExportModal } from "@/components/builder/github-export-modal";
import { LeadsModal } from "@/components/builder/leads-modal";
import { ContentEditor } from "@/components/builder/content-editor";
import { GenerationOverlay } from "@/components/builder/generation-overlay";
import { renderDocumentBody, renderDocumentCss } from "@shared/renderer";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { postWithCapacityRetry } from "@/lib/generate-fetch";
import { AiwbMark } from "@/components/brand/aiwb-mark";
import { ChatPanel } from "@/components/builder/chat-panel";

const INITIAL_HTML = `<main class="stage"><section class="copy"><p class="kicker">New website</p><h1>Start with what the business does.</h1><p class="sub">Write one sentence in the bar below. The first draft will take shape here as sections, type, and imagery.</p><div class="steps"><span>01 Structure</span><span>02 Writing</span><span>03 Imagery</span></div></section><div class="page" aria-hidden="true"><div class="page-head"><i></i><i></i><i></i></div><div class="page-body"><b></b><b class="short"></b><p></p><p class="small"></p><div class="page-grid"><i></i><i></i><i></i></div></div></div></main>`;
// The empty-state document, rendered inside the preview iframe. Literal values,
// not tokens, because the app's custom properties do not cross the iframe
// boundary. Keep in step with styles/crowe/colors.css.
const INITIAL_CSS = `@font-face{font-family:Fraunces;src:url('/fonts/fraunces-var.woff2')}@font-face{font-family:Inter;src:url('/fonts/inter-var.woff2')}@font-face{font-family:'JetBrains Mono';src:url('/fonts/jetbrains-mono-var.woff2')}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f3ea;color:#1a1714;font-family:Inter,Arial,sans-serif;padding:clamp(2rem,6vw,5rem);position:relative;overflow:hidden}body::before{content:'';position:absolute;inset:0;background:linear-gradient(to right,rgba(26,23,20,.055) 1px,transparent 1px),linear-gradient(to bottom,rgba(26,23,20,.055) 1px,transparent 1px);background-size:72px 72px;mask-image:linear-gradient(to bottom right,#000,transparent 80%);pointer-events:none}.stage{position:relative;z-index:1;width:min(100%,62rem);display:grid;grid-template-columns:1.05fr .75fr;gap:clamp(3rem,7vw,7rem);align-items:center}.kicker{margin:0 0 1.4rem;font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:#92702f}h1{margin:0;max-width:10ch;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:clamp(2.7rem,5.4vw,5rem);line-height:.98;letter-spacing:-.035em}.sub{margin:1.5rem 0 0;max-width:30rem;font-size:1rem;line-height:1.7;color:#6b6457}.steps{display:flex;flex-wrap:wrap;gap:1rem 1.5rem;margin-top:2rem;padding-top:1.25rem;border-top:1px solid rgba(26,23,20,.13);font-family:'JetBrains Mono',monospace;font-size:.55rem;letter-spacing:.16em;text-transform:uppercase;color:#6b6457}.page{background:#fffdf8;border:1px solid rgba(26,23,20,.16);box-shadow:0 22px 60px rgba(26,23,20,.13);transform:rotate(1.5deg)}.page-head{height:2rem;display:flex;align-items:center;gap:.35rem;padding:0 .8rem;background:#1a1714}.page-head i{width:.35rem;height:.35rem;border-radius:50%;background:rgba(247,243,234,.28)}.page-body{padding:2rem}.page-body b,.page-body p,.page-grid i{display:block;background:#1a1714}.page-body b{width:78%;height:.8rem}.page-body b.short{width:52%;margin-top:.55rem}.page-body p{width:92%;height:.28rem;margin:1.5rem 0 0;opacity:.24}.page-body p.small{width:68%;margin-top:.45rem}.page-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.55rem;margin-top:2.2rem}.page-grid i{aspect-ratio:1;opacity:.09}.page-grid i:first-child{background:#b8893a;opacity:.4}@media(max-width:760px){body{padding:2rem}.stage{grid-template-columns:1fr}.page{display:none}.steps{gap:.7rem 1rem}}`;

// The conversational builder is the DEFAULT interface (C3 complete, flag
// flipped 2026-06-07). ?chat=0 is the escape hatch back to the legacy dock —
// keep it until the dock is deleted outright.
// Hoisted to module scope so it's stable before any state is declared and
// so the initial useState for html can branch on it without a condition hook.
// Guard typeof window for SSR safety.
const chatEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("chat") !== "0";

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
      // Photography, for every plan. This was Pro-only, which meant every build
      // a prospective customer ever saw shipped grey gradients. The server
      // decides how many images the plan gets and returns the document
      // untouched when the budget is spent.
      void generateImages(fData.document);
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

  // Real topical photography (~50s an image on Azure) fetched AFTER the site is
  // on screen, then swapped into the document. Never blocks the build: the site
  // is usable the moment the text lands, and any failure or spent budget just
  // leaves the gradients in place.
  const generateImages = async (document: any) => {
    setImaging(true);
    try {
      const res = await fetch("/api/generate/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ document }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.imagesAdded) return; // nothing changed, so do not repaint or crow
      setDoc(data.document);
      setHtml(data.html);
      setCss(data.css);
      toast({
        title: data.imagesAdded > 1 ? "Photos added" : "Photo added",
        description: "Shot for this site, not picked from a stock library.",
      });
    } catch {
      // best-effort; the site already works with gradients
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

  // Reopening a saved project (/builder?project=<id>) restores the workspace:
  // the structured doc re-renders the preview (falling back to stored html/css
  // for legacy doc-less projects), and projectId landing makes the chat panel
  // hydrate the persisted transcript — cross-device continuity (C3).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("project");
    if (!id) return;
    (async () => {
      try {
        const r = await fetch(`/api/projects/${id}`, { credentials: "include" });
        if (!r.ok) return; // unknown id: stay in turn-zero state
        const p = await r.json();
        setProjectId(p.id);
        setProjectName(p.name ?? "Untitled site");
        if (p.prompt) setLastPrompt(p.prompt);
        if (p.document) {
          setDoc(p.document);
          setHtml(renderDocumentBody(p.document));
          setCss(renderDocumentCss(p.document));
        } else {
          setHtml(p.html ?? "");
          setCss(p.css ?? "");
        }
        setStep("refine");
      } catch {
        // network hiccup: leave the builder in its default state
      }
    })();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasGenerated = doc !== null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-graphite font-sans text-parchment">
      <div aria-hidden className="grain" />
      {/* Top bar */}
      <header className="z-10 flex h-14 items-center justify-between border-b border-white/[0.08] bg-[#0c0f13] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/">
            <button className="flex h-8 w-8 items-center justify-center border border-white/[0.1] text-parchment/60 transition-colors hover:border-white/[0.2] hover:text-parchment">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex min-w-0 items-center gap-2.5">
            <AiwbMark size={20} className="shrink-0 text-parchment" />
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-36 truncate bg-transparent text-sm font-medium text-parchment outline-none transition-colors focus:border-b focus:border-accent sm:w-44"
            />
          </div>
        </div>

        <div className="hidden lg:block">
          <JourneyRail current={step} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {user ? (
            <span className="mr-1 hidden font-mono text-[0.68rem] text-parchment/50 sm:inline">{user.username}{user.plan === "pro" && <span className="ml-1 font-semibold text-accent">· PRO</span>}</span>
          ) : (
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setShowAuth(true)}>Sign in</Button>
          )}
          {user?.plan !== "pro" && (
            <button onClick={() => setShowBilling(true)} className="hidden h-8 border border-accent/50 px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 sm:block">Upgrade</button>
          )}
          {/* Utility actions only exist once there's a site to act on — before
              that they'd just clutter the empty state as a row of grey buttons. */}
          {hasGenerated && (
            <>
              <div className="mx-1 h-5 w-px bg-white/[0.1]" />
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
          <Button size="sm" className="h-8 gap-1.5 rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-soft" onClick={handlePublish} disabled={isPublishing || !hasGenerated}>
            {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{isPublishing ? "Publishing" : "Publish"}
          </Button>
        </div>
      </header>

      {/* Published banner */}
      {publishedUrl && (
        <div className="flex items-center justify-between border-b border-accent/30 bg-accent/10 px-5 py-2.5 text-sm">
          <div className="flex min-w-0 items-center gap-2 text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            <span className="shrink-0 font-medium">Live at</span>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer" className="truncate font-mono hover:underline">{publishedUrl}</a>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-accent" onClick={() => { navigator.clipboard?.writeText(publishedUrl); toast({ title: "Copied" }); }}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-accent"><ExternalLink className="h-3.5 w-3.5" /> Visit</Button>
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
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-accent/25 bg-graphite-soft/90 px-4 py-2 shadow-xl backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              <span className="font-mono text-xs text-parchment/80">Writing your copy…</span>
            </div>
          )}
          {imaging && !filling && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-accent/25 bg-graphite-soft/90 px-4 py-2 shadow-xl backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
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
                  <div className="rounded-2xl border border-accent/25 bg-graphite-soft p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <Wand2 className="h-3.5 w-3.5 text-accent" />
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/55">Refine, tap to apply</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {refineIntents.map((r) => (
                        <button key={r.label} onClick={() => handleRefine(r.instruction)} disabled={isGenerating}
                          className="rounded-full border border-accent/20 bg-graphite-soft px-3 py-1.5 text-sm font-medium text-parchment/85 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50">
                          {r.label}
                        </button>
                      ))}
                      <button onClick={generateHeroVideo} disabled={isGenerating || videoPct !== null}
                        className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50">
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
