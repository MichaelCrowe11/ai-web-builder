import { useState, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import { BillingModal } from "@/components/settings/billing-modal";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  Download,
  Rocket,
  Save,
  Check,
  ExternalLink,
  Copy,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Empty-state placeholder, on-brand (warm ink, ember, Fraunces serif).
const INITIAL_HTML = `
  <div class="stage">
    <p class="kicker">A blank canvas</p>
    <h1>Your website<br/><em>starts with a sentence.</em></h1>
    <p class="sub">Describe your business in the box below — or tap a starter — and watch it come to life right here.</p>
  </div>
`;

const INITIAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..500&family=Instrument+Sans:wght@400..600&family=JetBrains+Mono:wght@500&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: hsl(40,38%,96%);
    color: hsl(24,14%,12%);
    font-family: 'Instrument Sans', sans-serif;
    padding: 3rem;
    text-align: center;
  }
  .stage { max-width: 40rem; }
  .kicker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem; letter-spacing: 0.25em; text-transform: uppercase;
    color: hsl(16,78%,48%); margin-bottom: 1.5rem;
  }
  h1 {
    font-family: 'Fraunces', serif; font-weight: 300;
    font-size: clamp(2.2rem, 6vw, 4rem); line-height: 1.0;
    letter-spacing: -0.02em;
  }
  h1 em { color: hsl(16,78%,52%); font-style: italic; }
  .sub {
    margin-top: 1.5rem; font-size: 1.05rem; line-height: 1.6;
    color: hsl(28,8%,40%); max-width: 28rem; margin-left: auto; margin-right: auto;
  }
`;

export default function Builder() {
  const { user } = useAuth();
  const [html, setHtml] = useState(INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled site");
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const saveProject = useCallback(async () => {
    setIsSaving(true);
    try {
      if (projectId) {
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ html, css, name: projectName }),
        });
      } else {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ html, css, name: projectName, prompt: lastPrompt }),
        });
        const project = await response.json();
        setProjectId(project.id);
      }
      toast({ title: "Saved", description: "Your work is safe." });
    } catch {
      toast({ title: "Save failed", description: "Could not save.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [html, css, projectId, projectName, lastPrompt, toast]);

  const handleExport = useCallback(() => {
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <style>* { margin: 0; padding: 0; box-sizing: border-box; }
  ${css}</style>
</head>
<body>${html}</body>
</html>`;
    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName.replace(/[^a-z0-9]/gi, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "Your site's HTML is saved." });
  }, [html, css, projectName, toast]);

  const handlePublish = useCallback(async () => {
    if (!user) {
      setShowAuth(true);
      return;
    }
    setIsPublishing(true);
    try {
      let id = projectId;
      if (!id) {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ html, css, name: projectName, prompt: lastPrompt }),
        });
        const project = await res.json();
        id = project.id;
        setProjectId(id);
      } else {
        await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ html, css, name: projectName }),
        });
      }
      const res = await apiRequest("POST", `/api/projects/${id}/publish`);
      const data = await res.json();
      setPublishedUrl(data.publishedUrl);
      setPreviewUrl(data.previewUrl);
      toast({ title: "Your site is live!", description: data.publishedUrl });
    } catch (error: any) {
      const msg = error?.message?.includes("401")
        ? "Please sign in to publish."
        : "Could not publish. Please try again.";
      toast({ title: "Publish failed", description: msg, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [user, projectId, html, css, projectName, lastPrompt, toast]);

  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        const error = await response.json();
        // Paywall / trial limit → nudge to sign up or upgrade.
        if (response.status === 402) {
          toast({ title: "You're out of free generations", description: error.details, variant: "destructive" });
          if (error.requiresAuth) setShowAuth(true);
          else if (error.requiresUpgrade) setShowBilling(true);
          return;
        }
        throw new Error(error.details || error.error || "Generation failed");
      }
      const result = await response.json();
      setHtml(result.html);
      setCss(result.css);
      setLastPrompt(prompt);
      setHasGenerated(true);
      toast({ title: "Here's your site", description: "Tweak it, regenerate, or publish." });
    } catch (error: any) {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[hsl(40,38%,96%)] font-sans overflow-hidden text-[hsl(24,14%,12%)]">
      {/* ============ Top bar — editorial ============ */}
      <header className="h-16 border-b border-[hsl(32,16%,86%)] flex items-center justify-between px-5 bg-[hsl(40,38%,97%)] z-10">
        <div className="flex items-center gap-4">
          <Link href="/">
            <button className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(32,16%,84%)] text-[hsl(24,14%,30%)] transition-colors hover:bg-[hsl(36,22%,90%)]">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(24,14%,12%)] font-heading text-base italic leading-none text-[hsl(40,38%,96%)]">
              a
            </div>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-44 bg-transparent font-heading text-base outline-none focus:border-b focus:border-[hsl(16,78%,50%)]"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <span className="mr-1 font-mono text-xs text-[hsl(28,8%,45%)]">
              {user.username}
              {user.plan === "pro" && <span className="ml-1 font-semibold text-[hsl(16,78%,48%)]">· PRO</span>}
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="font-medium" onClick={() => setShowAuth(true)}>
              Sign in
            </Button>
          )}
          {user?.plan !== "pro" && (
            <button
              onClick={() => setShowBilling(true)}
              className="rounded-full border border-[hsl(16,78%,50%)] px-3 py-1.5 text-sm font-semibold text-[hsl(16,78%,46%)] transition-colors hover:bg-[hsl(16,70%,94%)]"
            >
              Upgrade
            </button>
          )}
          <div className="mx-1 h-5 w-px bg-[hsl(32,16%,84%)]" />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[hsl(24,14%,25%)]"
            onClick={saveProject}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-[hsl(24,14%,25%)]" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button
            size="sm"
            className="gap-1.5 rounded-full bg-[hsl(24,14%,12%)] px-5 font-semibold text-[hsl(40,38%,96%)] hover:bg-[hsl(24,14%,20%)]"
            onClick={handlePublish}
            disabled={isPublishing}
          >
            {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {isPublishing ? "Publishing" : "Publish"}
          </Button>
        </div>
      </header>

      {/* ============ Published banner ============ */}
      {publishedUrl && (
        <div className="flex items-center justify-between border-b border-[hsl(16,60%,80%)] bg-[hsl(16,70%,94%)] px-5 py-2.5 text-sm">
          <div className="flex min-w-0 items-center gap-2 text-[hsl(16,78%,32%)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(16,78%,50%)]" />
            <span className="shrink-0 font-medium">Live at</span>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer" className="truncate font-mono hover:underline">
              {publishedUrl}
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[hsl(16,78%,32%)]"
              onClick={() => {
                navigator.clipboard?.writeText(publishedUrl);
                toast({ title: "Copied" });
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[hsl(16,78%,32%)]">
                <ExternalLink className="h-3.5 w-3.5" /> Visit
              </Button>
            </a>
          </div>
        </div>
      )}

      {/* ============ Workspace: full-bleed canvas + floating prompt ============ */}
      <div className="relative flex-1 overflow-hidden">
        <PreviewFrame html={html} css={css} device={device} onDeviceChange={setDevice} />

        {/* generating shimmer */}
        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[hsl(40,38%,96%)]/70 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-full border border-[hsl(32,16%,84%)] bg-white px-5 py-3 shadow-xl">
              <Sparkles className="h-4 w-4 animate-pulse text-[hsl(16,78%,50%)]" />
              <span className="font-mono text-sm text-[hsl(24,14%,25%)]">Designing your site…</span>
            </div>
          </div>
        )}

        {/* floating prompt */}
        <div className="pointer-events-none absolute inset-x-0 bottom-7 z-20 px-4">
          <div className="pointer-events-auto">
            <PromptInput onGenerate={handleGenerate} isGenerating={isGenerating} />
          </div>
        </div>
      </div>

      <BillingModal open={showBilling} onOpenChange={setShowBilling} />
      <AuthModal open={showAuth} onOpenChange={setShowAuth} defaultMode="register" />
    </div>
  );
}
