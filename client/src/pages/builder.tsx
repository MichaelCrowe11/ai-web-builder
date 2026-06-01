import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import { DesignControls } from "@/components/builder/design-controls";
import { BillingModal } from "@/components/settings/billing-modal";
import { EnvironmentSwitch } from "@/components/settings/environment-switch";
import { Cpu, ChevronLeft, Download, Rocket, Gem, Save, Check, ExternalLink, Copy, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Friendly placeholder shown before the user generates anything.
const INITIAL_HTML = `
  <div class="hero">
    <h1>Your website starts here</h1>
    <p>Describe your business in the box below, or pick a starter — we'll build it for you in seconds.</p>
    <button class="cta-button">✨ Try a prompt below</button>
  </div>
  <div class="features">
    <div class="feature-card">
      <h3>1. Describe it</h3>
      <p>Tell us what your business does in a sentence.</p>
    </div>
    <div class="feature-card">
      <h3>2. Watch it build</h3>
      <p>A polished website appears in seconds.</p>
    </div>
    <div class="feature-card">
      <h3>3. Publish</h3>
      <p>Go live with one click — hosting included.</p>
    </div>
  </div>
`;

const INITIAL_CSS = `
  :root {
    --primary: #4F46E5;
    --text: #1F2937;
    --bg: #F9FAFB;
    --card-bg: #FFFFFF;
    --radius: 8px;
  }
  
  body {
    background-color: var(--bg);
    color: var(--text);
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    line-height: 1.5;
  }
  
  .hero {
    text-align: center;
    padding: 4rem 0;
  }
  
  h1 {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 3.5rem;
    font-weight: 800;
    margin-bottom: 1rem;
    background: linear-gradient(135deg, var(--primary), #818CF8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  
  p {
    font-family: 'Inter', sans-serif;
    font-size: 1.25rem;
    color: #6B7280;
    margin-bottom: 2rem;
  }
  
  .cta-button {
    background-color: var(--primary);
    color: white;
    border: none;
    padding: 1rem 2rem;
    font-size: 1rem;
    font-weight: 600;
    border-radius: var(--radius);
    cursor: pointer;
    transition: transform 0.2s;
  }
  
  .cta-button:hover {
    transform: translateY(-2px);
  }
  
  .features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
    margin-top: 4rem;
  }
  
  .feature-card {
    background-color: var(--card-bg);
    padding: 2rem;
    border-radius: var(--radius);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(0,0,0,0.05);
  }
  
  h3 {
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
  }
`;

export default function Builder() {
  const [html, setHtml] = useState(INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [showBilling, setShowBilling] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { toast } = useToast();

  // Save project
  const saveProject = useCallback(async () => {
    setIsSaving(true);
    try {
      if (projectId) {
        // Update existing project
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html, css, name: projectName }),
        });
      } else {
        // Create new project
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html, css, name: projectName, prompt: lastPrompt }),
        });
        const project = await response.json();
        setProjectId(project.id);
      }
      toast({ title: "Project Saved", description: "Your changes have been saved." });
    } catch (error) {
      toast({ title: "Save Failed", description: "Could not save project.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [html, css, projectId, projectName, lastPrompt, toast]);

  // Export project as HTML file
  const handleExport = useCallback(() => {
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projectName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${css}
  </style>
</head>
<body>
  ${html}
</body>
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

    toast({ title: "Exported", description: "Your website has been downloaded." });
  }, [html, css, projectName, toast]);

  // Publish: save the project (if needed) then make it live at a public URL.
  const handlePublish = useCallback(async () => {
    setIsPublishing(true);
    try {
      // Ensure the project is saved so the server has a row to publish.
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
      toast({
        title: "Your site is live! 🎉",
        description: data.publishedUrl,
      });
    } catch (error: any) {
      const msg = error?.message?.includes("401")
        ? "Please sign in to publish your site."
        : "Could not publish. Please try again.";
      toast({ title: "Publish failed", description: msg, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [projectId, html, css, projectName, lastPrompt, toast]);

  const handleGenerate = async (prompt: string) => {
    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Generation failed");
      }

      const result = await response.json();

      setHtml(result.html);
      setCss(result.css);
      setLastPrompt(prompt);
      toast({
        title: "Website Generated",
        description: "Your AI-powered design is ready to preview.",
      });
    } catch (error: any) {
      console.error("Generation error:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate website. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDesignChange = (key: string, value: any) => {
    // Simple mock implementation of updating CSS variables
    if (key === "primaryColor") {
      setCss(prev => prev.replace(/--primary: #[A-Fa-f0-9]{6}/, `--primary: ${value}`));
    }
    if (key === "borderRadius") {
      setCss(prev => prev.replace(/--radius: \d+px/, `--radius: ${value}px`));
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background font-sans overflow-hidden">
      {/* Top Bar */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-background z-10">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
             <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
                <Cpu className="h-3.5 w-3.5" />
              </div>
            <span className="font-semibold text-sm">Untitled Project</span>
          </div>
          
          <div className="h-4 w-px bg-border mx-2" />
          <EnvironmentSwitch />
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-2 text-amber-500 hover:text-amber-600 hover:bg-amber-50" onClick={() => setShowBilling(true)}>
            <Gem className="h-4 w-4" /> Upgrade
          </Button>
          <div className="h-4 w-px bg-border mx-2" />
          <Button variant="outline" size="sm" className="gap-2" onClick={saveProject} disabled={isSaving}>
            {isSaving ? <Save className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />}
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-2 bg-gradient-to-r from-primary to-indigo-500 hover:from-primary/90 hover:to-indigo-500/90"
            onClick={handlePublish}
            disabled={isPublishing}
          >
            {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {isPublishing ? "Publishing..." : "Publish"}
          </Button>
        </div>
      </header>
      
      {/* Published banner */}
      {publishedUrl && (
        <div className="bg-green-500/10 border-b border-green-500/30 px-4 py-2 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 min-w-0">
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="font-medium shrink-0">Live at</span>
            <a
              href={previewUrl ?? publishedUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono truncate hover:underline"
            >
              {publishedUrl}
            </a>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7"
              onClick={() => {
                navigator.clipboard?.writeText(publishedUrl);
                toast({ title: "Copied", description: "URL copied to clipboard." });
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <a href={previewUrl ?? publishedUrl} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="gap-1.5 h-7">
                <ExternalLink className="h-3.5 w-3.5" /> Visit
              </Button>
            </a>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Preview Area (Center) */}
        <div className="flex-1 flex flex-col relative">
          <PreviewFrame 
            html={html} 
            css={css} 
            device={device} 
            onDeviceChange={setDevice} 
          />
          
          {/* Floating Prompt Input */}
          <div className="absolute bottom-8 left-0 right-0 z-20 px-4 pointer-events-none">
            <div className="pointer-events-auto">
              <PromptInput onGenerate={handleGenerate} isGenerating={isGenerating} />
            </div>
          </div>
        </div>
        
        {/* Right Sidebar (Design) */}
        <DesignControls config={{}} onChange={handleDesignChange} />
      </div>

      <BillingModal open={showBilling} onOpenChange={setShowBilling} />
    </div>
  );
}