import { useState, useCallback, useEffect } from "react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import { JourneyRail, JourneyNudge, type JourneyStep } from "@/components/builder/journey-rail";
import { BillingModal } from "@/components/settings/billing-modal";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft, Download, Rocket, Save, Loader2, ExternalLink, Copy, Sparkles, Wand2, FolderOpen, Zap, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  renderDocumentBody, renderDocumentCss, renderOutlineBody, renderOutlineCss, type SiteOutline,
} from "@shared/renderer";
import type { SiteDocument, ThemePreset, SectionType } from "@shared/site-document";

// Quota the server returns alongside each generation. null limit = unlimited (Pro).
interface Quota { plan: string; used: number; limit: number | null; remaining: number | null; }

// Tappable refine chips. Theme chips apply INSTANTLY on the client (local CSS
// recompute, no AI/network); copy/add chips do a section-scoped Azure call.
type RefineIntent =
  | { id: string; label: string; kind: "theme"; preset: ThemePreset }
  | { id: string; label: string; kind: "copy"; scope: SectionType; instruction: string }
  | { id: string; label: string; kind: "add"; section: SectionType; instruction: string };

// On-brand empty state (shown before first generation).
const INITIAL_HTML = `<div class="stage"><p class="kicker">A blank canvas</p><h1>Your website<br/><em>starts with a sentence.</em></h1></div>`;
const INITIAL_CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=JetBrains+Mono:wght@500&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#e8e2cf;font-family:'Inter',sans-serif;padding:3rem 3rem 16rem;text-align:center;background-image:radial-gradient(40rem 30rem at 50% -10%,rgba(191,166,105,0.10),transparent 60%)}.stage{max-width:40rem}.kicker{font-family:'JetBrains Mono',monospace;font-size:.7rem;letter-spacing:.25em;text-transform:uppercase;color:#bfa669;margin-bottom:1.5rem}h1{font-family:'Inter',sans-serif;font-weight:600;font-size:clamp(2.2rem,6vw,4rem);line-height:1.05;letter-spacing:-0.03em}h1 em{color:#bfa669;font-style:normal}.sub{margin-top:1.5rem;font-size:1.05rem;line-height:1.6;color:rgba(232,226,207,0.6);max-width:28rem;margin-left:auto;margin-right:auto}`;

export default function Builder() {
  const { user } = useAuth();
  const search = useSearch();
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [reopened, setReopened] = useState(false);
  // Two-phase generation: "outline" = planning (full overlay), "fill" = writing
  // copy (skeleton already visible, subtle badge).
  const [phase, setPhase] = useState<null | "outline" | "fill">(null);
  const [html, setHtml] = useState(INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled site");
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [step, setStep] = useState<JourneyStep>("describe");
  const [refineIntents, setRefineIntents] = useState<RefineIntent[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [showBilling, setShowBilling] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [savedVersionLabel, setSavedVersionLabel] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { toast } = useToast();

  // Load the tappable refine suggestions once.
  useEffect(() => {
    fetch("/api/refine/intents")
      .then((r) => r.json())
      .then((d) => setRefineIntents(d.intents ?? []))
      .catch(() => {});
  }, []);

  // Seed the quota display from the signed-in user (server is the source of
  // truth; each generation returns a fresh quota that overrides this).
  useEffect(() => {
    if (user) {
      setQuota({
        plan: user.plan,
        used: user.generationsUsed,
        limit: user.generationsLimit,
        remaining: user.generationsLimit === null ? null : Math.max(0, user.generationsLimit - user.generationsUsed),
      });
    }
  }, [user]);

  // Reopen a saved project via /builder?project=<id>. Projects store rendered
  // html/css (not the structured doc), so refine chips are unavailable until
  // the user regenerates — we surface that honestly rather than dead buttons.
  useEffect(() => {
    const id = new URLSearchParams(search).get("project");
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`, { credentials: "include" });
        if (!res.ok) throw new Error("not found");
        const p = await res.json();
        if (cancelled) return;
        setHtml(p.html);
        setCss(p.css);
        setProjectName(p.name);
        setProjectId(p.id);
        setLastPrompt(p.prompt ?? null);
        setReopened(true);
        setSavedVersionLabel(null);
        if (p.isPublished && p.publishedUrl) {
          setPublishedUrl(p.publishedUrl);
          setPreviewUrl(p.slug ? `/s/${p.slug}` : null);
          setStep("done");
        } else {
          setStep("refine");
        }
      } catch {
        if (!cancelled) toast({ title: "Couldn't open that site", variant: "destructive" });
      }
    })();
    return () => { cancelled = true; };
  }, [search, toast]);

  // Handle a 402 paywall response consistently.
  const handlePaywall = (error: any): boolean => {
    if (error?.requiresAuth) { setShowAuth(true); return true; }
    if (error?.requiresUpgrade) { setShowBilling(true); return true; }
    return false;
  };

  // First generation, TWO-PHASE for perceived speed:
  //   1) outline -> render a themed skeleton instantly
  //   2) fill    -> swap in the real, copy-complete site
  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    setPhase("outline");
    setSavedVersionLabel(null);
    try {
      // Phase 1: structure only (cheap + fast).
      const r1 = await fetch("/api/generate/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const d1 = await r1.json();
      if (!r1.ok) {
        if (r1.status === 402) {
          toast({ title: "You're out of free generations", description: d1.details || d1.error, variant: "destructive" });
          handlePaywall(d1);
          return;
        }
        throw new Error(d1.details || d1.error || "Generation failed");
      }
      const outline: SiteOutline = d1.outline;
      // Paint the skeleton immediately, then keep working.
      setHtml(renderOutlineBody(outline));
      setCss(renderOutlineCss(outline));
      if (outline.meta?.name) setProjectName(outline.meta.name);
      setStep("refine");
      setPhase("fill");

      // Phase 2: write the copy.
      const r2 = await fetch("/api/generate/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt, outline }),
      });
      const d2 = await r2.json();
      if (!r2.ok) {
        if (r2.status === 402) {
          toast({ title: "You're out of free generations", description: d2.details || d2.error, variant: "destructive" });
          handlePaywall(d2);
          return;
        }
        throw new Error(d2.details || d2.error || "Generation failed");
      }
      setDoc(d2.document);
      setReopened(false);
      setHtml(d2.html);
      setCss(d2.css);
      setSavedVersionLabel(null);
      setLastPrompt(prompt);
      if (d2.quota) setQuota(d2.quota);
      if (d2.document?.meta?.name) setProjectName(d2.document.meta.name);
      toast({ title: "Here's your site", description: "Tweak it with a suggestion, or publish." });
    } catch (error: any) {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
      setPhase(null);
    }
  };

  // INSTANT theme change — pure local CSS recompute, no AI and no network.
  // (renderDocumentBody is theme-independent, but we re-render both for clarity.)
  const applyTheme = (preset: ThemePreset) => {
    if (!doc) return;
    const next: SiteDocument = { ...doc, theme: { ...doc.theme, preset } };
    setDoc(next);
    setHtml(renderDocumentBody(next));
    setCss(renderDocumentCss(next));
    setSavedVersionLabel(null);
    toast({ title: "Look updated" });
  };

  // SCOPED refine — edit or add ONE section via the model.
  const refineSection = async (mode: "edit" | "add", target: SectionType, instruction: string) => {
    if (!doc) return;
    setIsGenerating(true);
    try {
      const res = await fetch("/api/refine/section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ document: doc, mode, target, instruction }),
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
      setSavedVersionLabel(null);
      if (data.quota) setQuota(data.quota);
      toast({ title: "Updated", description: "Your change is in." });
    } catch (error: any) {
      toast({ title: "Couldn't apply that", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  // Route a chip tap to the right handler based on its kind.
  const applyIntent = (r: RefineIntent) => {
    if (r.kind === "theme") applyTheme(r.preset);
    else if (r.kind === "copy") refineSection("edit", r.scope, r.instruction);
    else refineSection("add", r.section, r.instruction);
  };

  const persistProject = useCallback(async (): Promise<string> => {
    if (projectId) {
      const r = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ html, css, name: projectName }),
      });
      if (!r.ok) throw new Error("Save failed");
      return projectId;
    }

    const r = await fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ html, css, name: projectName, prompt: lastPrompt }),
    });
    if (!r.ok) throw new Error("Save failed");
    const p = await r.json();
    setProjectId(p.id);
    return p.id;
  }, [html, css, projectId, projectName, lastPrompt]);

  const saveProject = useCallback(async () => {
    setIsSaving(true);
    try {
      await persistProject();
      toast({ title: "Saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [persistProject, toast]);

  const createDeploymentVersion = useCallback(async (id: string) => {
    const res = await apiRequest("POST", `/api/projects/${id}/versions`);
    const data = await res.json();
    setSavedVersionLabel(`v${data.version.versionNumber}`);
    return data.version as { id: string; versionNumber: number };
  }, []);

  const saveDeploymentVersion = useCallback(async () => {
    if (!user) { setShowAuth(true); return; }
    setIsSavingVersion(true);
    try {
      const id = await persistProject();
      const version = await createDeploymentVersion(id);
      toast({ title: `Saved version v${version.versionNumber}`, description: "Ready to review or publish." });
    } catch {
      toast({ title: "Version save failed", variant: "destructive" });
    } finally {
      setIsSavingVersion(false);
    }
  }, [user, persistProject, createDeploymentVersion, toast]);

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
      const id = await persistProject();
      const version = await createDeploymentVersion(id);
      const res = await apiRequest("POST", `/api/projects/${id}/versions/${version.id}/deploy`);
      const data = await res.json();
      setPublishedUrl(data.publishedUrl);
      setPreviewUrl(data.previewUrl);
      setStep("done");
      toast({ title: `Version v${version.versionNumber} is live`, description: data.publishedUrl });
    } catch (error: any) {
      const msg = error?.message?.includes("401") ? "Please sign in to publish." : "Could not publish.";
      toast({ title: "Publish failed", description: msg, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [user, persistProject, createDeploymentVersion, toast]);

  const hasGenerated = doc !== null || reopened;

  // Compact quota label for the header. Hidden for Pro/unlimited.
  const quotaLabel =
    quota && quota.limit !== null
      ? `${Math.max(0, quota.limit - quota.used)}/${quota.limit} left`
      : null;

  return (
    <div className="h-screen flex flex-col bg-[#0b0b0c] font-sans overflow-hidden text-[#e8e2cf]">
      {/* Top bar */}
      <header className="h-16 border-b border-[rgba(191,166,105,0.18)] flex items-center justify-between px-5 bg-[#15151a] z-10">
        <div className="flex items-center gap-4">
          <Link href="/">
            <button className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(191,166,105,0.18)] text-[rgba(232,226,207,0.7)] transition-colors hover:bg-[#15151a]">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e8e2cf] font-heading text-base italic leading-none text-[#0b0b0c]">a</div>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="w-40 bg-transparent font-heading text-base outline-none focus:border-b focus:border-[#bfa669]" />
          </div>
        </div>

        {/* Journey rail — center */}
        <JourneyRail current={step} />

        <div className="flex items-center gap-2">
          {/* Generations remaining today (hidden for Pro/unlimited) */}
          {quotaLabel && (
            <span
              className="hidden font-mono text-[0.7rem] text-[rgba(232,226,207,0.55)] sm:inline"
              title="Free generations remaining today"
            >
              {quotaLabel}
            </span>
          )}
          {user ? (
            <>
              <Link href="/projects">
                <button
                  className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-sm text-[rgba(232,226,207,0.7)] transition-colors hover:bg-[#15151a] hover:text-[#bfa669] sm:flex"
                  title="Your saved sites"
                >
                  <FolderOpen className="h-4 w-4" /> My sites
                </button>
              </Link>
              <span className="mr-1 font-mono text-xs text-[rgba(232,226,207,0.55)]">{user.username}{user.plan === "pro" && <span className="ml-1 font-semibold text-[#bfa669]">· PRO</span>}</span>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setShowAuth(true)}>Sign in</Button>
          )}
          {user?.plan !== "pro" && (
            <button onClick={() => setShowBilling(true)} className="rounded-full border border-[#bfa669] px-3 py-1.5 text-sm font-semibold text-[#bfa669] transition-colors hover:bg-[rgba(191,166,105,0.12)]">Upgrade</button>
          )}
          <div className="mx-1 h-5 w-px bg-[rgba(191,166,105,0.18)]" />
          <Button variant="ghost" size="sm" className="gap-1.5 text-[rgba(232,226,207,0.8)]" onClick={saveProject} disabled={isSaving || !hasGenerated}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[rgba(232,226,207,0.8)]"
            onClick={saveDeploymentVersion}
            disabled={isSavingVersion || !hasGenerated}
            title="Save a reviewable deployment version"
          >
            {isSavingVersion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            <span className="hidden lg:inline">{savedVersionLabel ?? "Version"}</span>
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-[rgba(232,226,207,0.8)]" onClick={handleExport} disabled={!hasGenerated}>
            <Download className="h-4 w-4" />Export
          </Button>
          <Button size="sm" className="gap-1.5 rounded-full bg-[#e8e2cf] px-5 font-semibold text-[#0b0b0c] hover:bg-[#d4be84]" onClick={handlePublish} disabled={isPublishing || !hasGenerated}>
            {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{isPublishing ? "Publishing" : "Publish"}
          </Button>
        </div>
      </header>

      {/* Published banner. We LEAD with the URL that actually resolves today
          (the /s/<slug> path), and show the custom subdomain as pending until
          wildcard DNS for ai-webbuilder.com is live — so we never advertise a
          link that 404s. `liveUrl` is the working, copyable absolute URL. */}
      {publishedUrl && (() => {
        const liveUrl = previewUrl
          ? `${window.location.origin}${previewUrl}`
          : publishedUrl;
        const dnsPending = Boolean(previewUrl) && liveUrl !== publishedUrl;
        return (
          <div className="flex items-center justify-between border-b border-[rgba(191,166,105,0.3)] bg-[rgba(191,166,105,0.12)] px-5 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-2 text-[#bfa669]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#bfa669]" />
              <span className="shrink-0 font-medium">Live at</span>
              <a href={liveUrl} target="_blank" rel="noreferrer" className="truncate font-mono hover:underline">{liveUrl}</a>
              {savedVersionLabel && (
                <span className="hidden shrink-0 font-mono text-[0.7rem] text-[rgba(232,226,207,0.55)] md:inline">
                  · {savedVersionLabel} deployed
                </span>
              )}
              {dnsPending && (
                <span className="hidden shrink-0 font-mono text-[0.7rem] text-[rgba(232,226,207,0.45)] md:inline">
                  · {publishedUrl.replace(/^https?:\/\//, "")} pending DNS
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[#bfa669]" onClick={() => { navigator.clipboard?.writeText(liveUrl); toast({ title: "Copied" }); }}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <a href={liveUrl} target="_blank" rel="noreferrer">
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[#bfa669]"><ExternalLink className="h-3.5 w-3.5" /> Visit</Button>
              </a>
            </div>
          </div>
        );
      })()}

      {/* Workspace */}
      <div className="relative flex-1 overflow-hidden">
        <PreviewFrame html={html} css={css} device={device} onDeviceChange={setDevice} />

        {/* Full overlay only while planning or doing a scoped refine. During the
            "fill" phase the skeleton is already on screen, so we don't cover it. */}
        {isGenerating && phase !== "fill" && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#0b0b0c]/70 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-full border border-[rgba(191,166,105,0.18)] bg-[#15151a] px-5 py-3 shadow-xl">
              <Sparkles className="h-4 w-4 animate-pulse text-[#bfa669]" />
              <span className="font-mono text-sm text-[rgba(232,226,207,0.8)]">{phase === "outline" ? "Designing your layout…" : "Applying your change…"}</span>
            </div>
          </div>
        )}
        {/* Non-blocking badge while the copy is being written over the skeleton. */}
        {phase === "fill" && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-[rgba(191,166,105,0.18)] bg-[#15151a]/90 px-4 py-2 shadow-lg backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-[#bfa669]" />
              <span className="font-mono text-xs text-[rgba(232,226,207,0.8)]">Writing your copy…</span>
            </div>
          </div>
        )}

        {/* Bottom dock: nudge + (refine chips OR prompt) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 px-4">
          <div className="pointer-events-auto mx-auto max-w-2xl">
            {/* Nudge only when there's nothing behind it to overlap */}
            {!hasGenerated && (
              <div className="mb-2 inline-block rounded-full bg-[#0b0b0c]/80 px-4 py-1 backdrop-blur-sm">
                <JourneyNudge current={step} />
              </div>
            )}

            {!hasGenerated ? (
              <PromptInput onGenerate={handleGenerate} isGenerating={isGenerating} />
            ) : (
              <div className="rounded-2xl border border-[rgba(191,166,105,0.25)] bg-[#15151a] p-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <Wand2 className="h-3.5 w-3.5 text-[#bfa669]" />
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[rgba(232,226,207,0.55)]">
                    {doc ? "Refine — tap to apply" : "Saved site — re-publish, or start over to refine with AI"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {doc &&
                    refineIntents.map((r) => (
                      <button key={r.id} onClick={() => applyIntent(r)} disabled={isGenerating && r.kind !== "theme"}
                        title={r.kind === "theme" ? "Instant — no waiting" : undefined}
                        className="flex items-center gap-1.5 rounded-full border border-[rgba(191,166,105,0.18)] bg-[#15151a] px-3 py-1.5 text-sm font-medium text-[rgba(232,226,207,0.85)] transition-colors hover:border-[#d4be84] hover:text-[#bfa669] disabled:opacity-50">
                        {r.kind === "theme" && <Zap className="h-3 w-3 text-[#bfa669]" />}
                        {r.label}
                      </button>
                    ))}
                  <button onClick={() => { setDoc(null); setReopened(false); setProjectId(null); setPublishedUrl(null); setPreviewUrl(null); setSavedVersionLabel(null); setHtml(INITIAL_HTML); setCss(INITIAL_CSS); setStep("describe"); }}
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-[rgba(232,226,207,0.5)] hover:text-[rgba(232,226,207,0.8)]">
                    Start over
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <BillingModal open={showBilling} onOpenChange={setShowBilling} />
      <AuthModal open={showAuth} onOpenChange={setShowAuth} defaultMode="register" />
    </div>
  );
}
