import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/builder/prompt-input";
import { PreviewFrame } from "@/components/builder/preview-frame";
import { DesignControls } from "@/components/builder/design-controls";
import { BillingModal } from "@/components/settings/billing-modal";
import { EnvironmentSwitch } from "@/components/settings/environment-switch";
import { Cpu, ChevronLeft, Download, Rocket, Share2, Gem } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [showBilling, setShowBilling] = useState(false);
  const { toast } = useToast();

  const handleGenerate = (prompt: string) => {
    setIsGenerating(true);
    
    // Simulate generation with different templates based on keywords
    setTimeout(() => {
      let newHtml = INITIAL_HTML;
      let newCss = INITIAL_CSS;
      
      const lowercasePrompt = prompt.toLowerCase();
      
      if (lowercasePrompt.includes("coffee") || lowercasePrompt.includes("cafe")) {
        newHtml = `
          <div class="hero">
            <h1>Artisan Coffee Roasters</h1>
            <p>Experience the perfect brew, roasted daily in small batches.</p>
            <button class="cta-button">Order Online</button>
          </div>
          <div class="features">
            <div class="feature-card">
              <h3>Ethically Sourced</h3>
              <p>Direct trade relationships with farmers.</p>
            </div>
            <div class="feature-card">
              <h3>Expertly Roasted</h3>
              <p>Master roasters ensuring peak flavor.</p>
            </div>
            <div class="feature-card">
              <h3>Delivered Fresh</h3>
              <p>From our roastery to your doorstep.</p>
            </div>
          </div>`;
        newCss = `
          :root {
            --primary: #78350f;
            --text: #292524;
            --bg: #fff7ed;
            --card-bg: #ffffff;
            --radius: 4px;
          }
          body {
            background-color: var(--bg);
            color: var(--text);
            padding: 2rem;
            max-width: 1200px;
            margin: 0 auto;
            line-height: 1.6;
            font-family: 'Lora', serif;
          }
          .hero { text-align: center; padding: 6rem 0; }
          h1 { 
            font-size: 4rem; 
            margin-bottom: 1rem; 
            color: var(--primary);
            font-weight: 700;
          }
          p { font-size: 1.25rem; color: #57534e; margin-bottom: 2rem; }
          .cta-button {
            background-color: var(--primary);
            color: white;
            border: none;
            padding: 1rem 2.5rem;
            font-size: 1.1rem;
            cursor: pointer;
            border-radius: var(--radius);
            font-family: sans-serif;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 3rem;
            margin-top: 4rem;
          }
          .feature-card {
            background-color: var(--card-bg);
            padding: 2.5rem;
            border-radius: var(--radius);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            text-align: center;
          }
          h3 { font-size: 1.5rem; margin-bottom: 0.5rem; color: var(--primary); }
        `;
      } else if (lowercasePrompt.includes("portfolio")) {
        newHtml = `
          <div class="hero">
            <h1>Alex Designer</h1>
            <p>Crafting digital experiences that matter.</p>
            <button class="cta-button">View Work</button>
          </div>
          <div class="features">
            <div class="feature-card">
              <h3>UI Design</h3>
              <p>Pixel perfect interfaces.</p>
            </div>
            <div class="feature-card">
              <h3>UX Research</h3>
              <p>User-centered design process.</p>
            </div>
            <div class="feature-card">
              <h3>Development</h3>
              <p>Bringing designs to life.</p>
            </div>
          </div>`;
        newCss = `
          :root {
            --primary: #000000;
            --text: #1a1a1a;
            --bg: #ffffff;
            --card-bg: #f5f5f5;
            --radius: 0px;
          }
          body {
            background-color: var(--bg);
            color: var(--text);
            padding: 2rem;
            max-width: 1200px;
            margin: 0 auto;
            line-height: 1.4;
            font-family: 'Inter', sans-serif;
          }
          .hero { text-align: left; padding: 8rem 0; }
          h1 { 
            font-size: 5rem; 
            margin-bottom: 1rem; 
            line-height: 0.9;
            letter-spacing: -2px;
          }
          p { font-size: 1.5rem; color: #666; margin-bottom: 3rem; }
          .cta-button {
            background-color: var(--primary);
            color: white;
            border: none;
            padding: 1rem 2rem;
            font-size: 1rem;
            cursor: pointer;
            border-radius: var(--radius);
          }
          .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-top: 4rem;
          }
          .feature-card {
            background-color: var(--card-bg);
            padding: 2rem;
            border-radius: var(--radius);
          }
          h3 { font-size: 1.25rem; margin-bottom: 0.5rem; }
        `;
      } else if (lowercasePrompt.includes("blog")) {
        newHtml = `
          <div class="hero">
            <h1>The Daily Tech</h1>
            <p>Insights into the future of technology and design.</p>
            <button class="cta-button">Subscribe</button>
          </div>
          <div class="features">
            <div class="feature-card">
              <h3>Latest News</h3>
              <p>Breaking stories from the tech world.</p>
            </div>
            <div class="feature-card">
              <h3>Tutorials</h3>
              <p>Learn how to build modern apps.</p>
            </div>
            <div class="feature-card">
              <h3>Opinion</h3>
              <p>Deep dives into industry trends.</p>
            </div>
          </div>`;
        newCss = `
          :root {
            --primary: #2563eb;
            --text: #334155;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --radius: 12px;
          }
          body {
            background-color: var(--bg);
            color: var(--text);
            padding: 2rem;
            max-width: 900px;
            margin: 0 auto;
            line-height: 1.8;
            font-family: 'Merriweather', serif;
          }
          .hero { text-align: center; padding: 5rem 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 4rem; }
          h1 { 
            font-size: 3rem; 
            margin-bottom: 1rem; 
            color: #0f172a;
            font-family: 'Inter', sans-serif;
            font-weight: 800;
          }
          p { font-size: 1.25rem; color: #64748b; margin-bottom: 2rem; font-style: italic; }
          .cta-button {
            background-color: var(--primary);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            font-size: 1rem;
            cursor: pointer;
            border-radius: 9999px;
            font-weight: 600;
            font-family: 'Inter', sans-serif;
          }
          .features {
            display: grid;
            grid-template-columns: 1fr;
            gap: 2rem;
          }
          .feature-card {
            background-color: var(--card-bg);
            padding: 2rem;
            border-radius: var(--radius);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          h3 { font-size: 1.25rem; margin: 0; font-family: 'Inter', sans-serif; font-weight: 700; }
          .feature-card p { margin: 0; font-size: 1rem; font-style: normal; }
        `;
      }

      setHtml(newHtml);
      setCss(newCss);
      setIsGenerating(false);
      toast({
        title: "Website Generated",
        description: "Your new design is ready to preview.",
      });
    }, 2000);
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
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="default" size="sm" className="gap-2">
            <Rocket className="h-4 w-4" /> Publish
          </Button>
        </div>
      </header>
      
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