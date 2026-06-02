import { useState, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import { JourneyRail, JourneyNudge, type JourneyStep } from "@/components/builder/journey-rail";
import { BillingModal } from "@/components/settings/billing-modal";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft, Download, Rocket, Save, Loader2, ExternalLink, Copy, Sparkles, Wand2, Github,
} from "lucide-react";
import { GitHubExportModal } from "@/components/builder/github-export-modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CroweHexC } from "@/components/brand/crowe-hex-c";

// Clean, modern workspace empty state (rarely seen - arriving from the home
// prompt auto-builds). Crowe gold-on-graphite, clean sans.
const INITIAL_HTML = `<div class="stage"><p class="kicker">Workspace</p><h1>Describe a website to begin.</h1><p class="sub">Type what you want in the bar below — a business, a vibe, a few details — and the workspace builds it live.</p></div>`;
const INITIAL_CSS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@500&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#e8e2cf;font-family:'Inter',system-ui,sans-serif;padding:4rem 2rem 17rem;text-align:center;position:relative}body::before{content:'';position:absolute;inset:0;background:radial-gradient(42rem 26rem at 50% -10%,rgba(191,166,105,0.12),transparent 62%);pointer-events:none}.stage{position:relative;z-index:1;max-width:36rem}.kicker{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.28em;text-transform:uppercase;color:#bfa669;margin-bottom:1.4rem}h1{font-weight:600;font-size:clamp(1.9rem,4.5vw,3rem);line-height:1.08;letter-spacing:-0.03em}.sub{margin:1.2rem auto 0;font-size:1rem;line-height:1.6;color:rgba(232,226,207,0.5);max-width:24rem}`;

interface RefineIntent { label: string; instruction: string; }

export default function Builder() {
  const { user } = useAuth();
  const [doc, setDoc] = useState<any | null>(null);
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
  const [showBilling, setShowBilling] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
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

  // Handle a 402 paywall response consistently.
  const handlePaywall = (error: any): boolean => {
    if (error?.requiresAuth) { setShowAuth(true); return true; }
    if (error?.requiresUpgrade) { setShowBilling(true); return true; }
    return false;
  };

  // First generation: prompt -> document -> rendered site.
  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    try {
      const res = await fetch("/api/generate/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          toast({ title: "You're out of free generations", description: data.details || data.error, variant: "destructive" });
          handlePaywall(data);
          return;
        }
        throw new Error(data.details || data.error || "Generation failed");
      }
      setDoc(data.document);
      setHtml(data.html);
      setCss(data.css);
      setLastPrompt(prompt);
      if (data.document?.meta?.name) setProjectName(data.document.meta.name);
      setStep("refine");
      toast({ title: "Here's your site", description: "Tweak it with a suggestion, or publish." });
    } catch (error: any) {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
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

  const saveProject = useCallback(async () => {
    setIsSaving(true);
    try {
      if (projectId) {
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ html, css, name: projectName }),
        });
      } else {
        const r = await fetch("/api/projects", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ html, css, name: projectName, prompt: lastPrompt }),
        });
        const p = await r.json();
        setProjectId(p.id);
      }
      toast({ title: "Saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [html, css, projectId, projectName, lastPrompt, toast]);

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
          <div className="mx-1 h-5 w-px bg-gold/20" />
          <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={saveProject} disabled={isSaving || !hasGenerated}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={handleExport} disabled={!hasGenerated}>
            <Download className="h-4 w-4" />Export
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-parchment/80" onClick={() => setShowGithub(true)} disabled={!hasGenerated}>
            <Github className="h-4 w-4" />GitHub
          </Button>
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
      <div className="relative flex-1 overflow-hidden">
        <PreviewFrame html={html} css={css} device={device} onDeviceChange={setDevice} />

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-graphite/70 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-full border border-gold/20 bg-graphite-soft px-5 py-3 shadow-xl">
              <Sparkles className="h-4 w-4 animate-pulse text-gold" />
              <span className="font-mono text-sm text-parchment/80">{hasGenerated ? "Applying your change…" : "Designing your site…"}</span>
            </div>
          </div>
        )}

        {/* Bottom dock: nudge + (refine chips OR prompt) */}
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
                  <button onClick={() => { setDoc(null); setHtml(INITIAL_HTML); setCss(INITIAL_CSS); setStep("describe"); }}
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-parchment/50 hover:text-parchment/80">
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
      <GitHubExportModal open={showGithub} onOpenChange={setShowGithub} name={projectName} html={html} css={css} />
    </div>
  );
}
