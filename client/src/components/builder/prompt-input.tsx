import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles, Loader2, Paperclip } from "lucide-react";

interface PromptInputProps {
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
}

// Vertical starter templates — pre-fill a rich, business-specific prompt so
// non-technical users never face a blank box. The label is the industry; the
// prompt is what we actually send to the model.
const STARTER_TEMPLATES = [
  {
    label: "Restaurant",
    prompt:
      "A warm, inviting website for a family-owned Italian restaurant. Include a hero with the restaurant name and tagline, a menu section with a few signature dishes and prices, hours and location, and a 'Reserve a table' call to action. Use appetizing imagery and a cozy color palette.",
  },
  {
    label: "Portfolio",
    prompt:
      "A clean, modern personal portfolio for a freelance photographer. Include a striking hero with my name, a gallery grid of work, a short about section, and a contact call to action. Minimal, elegant, lots of whitespace.",
  },
  {
    label: "Local service",
    prompt:
      "A trustworthy website for a local plumbing business. Include a hero with the business name and phone number, a list of services, a 'Why choose us' section with trust badges, customer reviews, and a prominent 'Get a free quote' button. Professional blue-and-white palette.",
  },
  {
    label: "Online store",
    prompt:
      "A bright e-commerce landing page for a small handmade-candle brand. Include a hero with a featured product, a grid of 3 best-sellers with prices, a short brand story, customer reviews, and a newsletter signup. Friendly, warm, modern.",
  },
  {
    label: "Event",
    prompt:
      "An exciting one-page website for a community music festival. Include a bold hero with the event name, date and location, a lineup section, a schedule, ticket pricing tiers with a 'Get tickets' button, and an FAQ. Energetic, colorful, modern.",
  },
];

export function PromptInput({ onGenerate, isGenerating }: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!prompt.trim() || isGenerating) return;
    onGenerate(prompt);
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [prompt]);

  return (
    <div className="bg-background/80 backdrop-blur-lg border border-border/50 rounded-xl shadow-2xl p-4 w-full max-w-3xl mx-auto transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your website... (e.g. 'A landing page for a coffee shop with a dark theme')"
          className="min-h-[60px] max-h-[200px] w-full resize-none bg-transparent border-none focus-visible:ring-0 p-0 text-base shadow-none pr-12"
          rows={1}
        />
        
        <div className="absolute right-0 bottom-0 flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
             <Paperclip className="h-4 w-4" />
          </Button>
          <Button 
            size="icon" 
            onClick={handleSubmit} 
            disabled={!prompt.trim() || isGenerating}
            className={`h-8 w-8 transition-all ${prompt.trim() ? "bg-primary" : "bg-muted text-muted-foreground"}`}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      
      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 pr-1">
          Start with:
        </span>
        {STARTER_TEMPLATES.map((t) => (
          <button
            key={t.label}
            onClick={() => setPrompt(t.prompt)}
            title={t.prompt}
            className="text-xs px-2.5 py-1 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap border border-border/50 shrink-0"
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}