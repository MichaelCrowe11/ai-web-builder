import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import { DesignControls } from "@/components/builder/design-controls";
import { BillingModal } from "@/components/settings/billing-modal";
import { EnvironmentSwitch } from "@/components/settings/environment-switch";
import { TemplateGallery } from "@/components/builder/template-gallery";
import { CodeView } from "@/components/builder/code-view";
import { KeyboardShortcuts } from "@/components/builder/keyboard-shortcuts";
import { AIThinkingAnimation } from "@/components/builder/ai-thinking-animation";
import { VersionHistory, type VersionSnapshot } from "@/components/builder/version-history";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Cpu, ChevronLeft, Download, Rocket, Gem, Save, Check, Code2, LayoutGrid, Clock, Keyboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Mock template for initial state
const INITIAL_HTML = `
  <div class="hero">
    <h1>Build Future-Ready Apps</h1>
    <p>Deploy scalable applications in seconds with our AI-powered infrastructure.</p>
    <button class="cta-button">Get Started</button>
  </div>
  <div class="features">
    <div class="feature-card">
      <h3>Fast</h3>
      <p>Blazing fast performance out of the box.</p>
    </div>
    <div class="feature-card">
      <h3>Secure</h3>
      <p>Enterprise-grade security by default.</p>
    </div>
    <div class="feature-card">
      <h3>Scalable</h3>
      <p>Grow from 1 to 1M users without friction.</p>
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const { toast } = useToast();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveProject();
      }
      // Ctrl/Cmd + E: Export
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        handleExport();
      }
      // Ctrl/Cmd + `: Toggle code view
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setShowCode(prev => !prev);
      }
      // Ctrl/Cmd + T: Template gallery
      if ((e.ctrlKey || e.metaKey) && e.key === "t") {
        e.preventDefault();
        setShowTemplates(prev => !prev);
      }
      // ?: Show keyboard shortcuts
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        setShowKeyboardShortcuts(true);
      }
      // Ctrl/Cmd + 1/2/3: Device switching
      if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        setDevice("desktop");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "2") {
        e.preventDefault();
        setDevice("tablet");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "3") {
        e.preventDefault();
        setDevice("mobile");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      
      // Add to version history
      // Use crypto.randomUUID if available, otherwise fallback to timestamp-based ID
      const generateId = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      };
      
      const newVersion: VersionSnapshot = {
        id: generateId(),
        html: result.html,
        css: result.css,
        prompt,
        timestamp: new Date(),
        label: prompt.length > 30 ? prompt.substring(0, 30) + "..." : prompt,
      };
      setVersions(prev => [newVersion, ...prev]);
      setCurrentVersionIndex(0);
      
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

  const handleTemplateSelect = (prompt: string) => {
    handleGenerate(prompt);
  };

  const handleVersionRestore = (version: VersionSnapshot) => {
    setHtml(version.html);
    setCss(version.css);
    const index = versions.findIndex(v => v.id === version.id);
    setCurrentVersionIndex(index);
    toast({ title: "Version Restored", description: "Previous version has been restored." });
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowTemplates(true)}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Templates</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowCode(true)}>
                <Code2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View Code</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowVersionHistory(prev => !prev)}>
                <Clock className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Version History</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowKeyboardShortcuts(true)}>
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Keyboard Shortcuts</TooltipContent>
          </Tooltip>
          
          <ThemeToggle />
          
          <div className="h-4 w-px bg-border mx-1" />
          
          <Button variant="ghost" size="sm" className="gap-2 text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950" onClick={() => setShowBilling(true)}>
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
          <Button variant="default" size="sm" className="gap-2 bg-gradient-to-r from-primary to-indigo-500 hover:from-primary/90 hover:to-indigo-500/90">
            <Rocket className="h-4 w-4" /> Publish
          </Button>
        </div>
      </header>
      
      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Preview Area (Center) */}
        <div className="flex-1 flex flex-col relative">
          <PreviewFrame 
            html={html} 
            css={css} 
            device={device} 
            onDeviceChange={setDevice} 
          />
          
          {/* AI Thinking Animation Overlay */}
          <AIThinkingAnimation isVisible={isGenerating} />
          
          {/* Template Gallery Overlay */}
          <TemplateGallery 
            isOpen={showTemplates} 
            onClose={() => setShowTemplates(false)} 
            onSelect={handleTemplateSelect}
          />
          
          {/* Code View Overlay */}
          <CodeView 
            html={html} 
            css={css} 
            isOpen={showCode} 
            onClose={() => setShowCode(false)} 
          />
          
          {/* Floating Prompt Input */}
          <div className="absolute bottom-8 left-0 right-0 z-20 px-4 pointer-events-none">
            <div className="pointer-events-auto">
              <PromptInput onGenerate={handleGenerate} isGenerating={isGenerating} />
            </div>
          </div>
        </div>
        
        {/* Version History Panel */}
        <VersionHistory
          versions={versions}
          currentIndex={currentVersionIndex}
          onRestore={handleVersionRestore}
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
        />
        
        {/* Right Sidebar (Design) */}
        <DesignControls config={{}} onChange={handleDesignChange} />
      </div>

      <BillingModal open={showBilling} onOpenChange={setShowBilling} />
      <KeyboardShortcuts open={showKeyboardShortcuts} onOpenChange={setShowKeyboardShortcuts} />
    </div>
  );
}