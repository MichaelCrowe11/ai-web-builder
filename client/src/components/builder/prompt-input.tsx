import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Loader2 } from "lucide-react";

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
    <div className="mx-auto w-full max-w-2xl">
      {/* starter chips, above the bar */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <span className="shrink-0 pr-1 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/55">
          Start with
        </span>
        {STARTER_TEMPLATES.map((t) => (
          <button
            key={t.label}
            onClick={() => setPrompt(t.prompt)}
            title={t.prompt}
            className="shrink-0 whitespace-nowrap rounded-full border border-accent/20 bg-graphite-soft/90 px-3 py-1 text-xs font-medium text-parchment/70 backdrop-blur transition-colors hover:border-accent/40 hover:text-accent"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2 rounded-2xl border border-accent/25 bg-graphite-soft/95 p-2.5 pl-4 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)] backdrop-blur-lg transition-all focus-within:border-accent focus-within:shadow-[0_0_40px_-10px_rgba(59,130,246,0.4)]">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your business, e.g. 'a cozy coffee shop in Tucson with online reservations'"
          className="max-h-[180px] min-h-[44px] w-full resize-none border-none bg-transparent p-0 py-2.5 text-base shadow-none placeholder:text-parchment/50 focus-visible:ring-0"
          rows={1}
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!prompt.trim() || isGenerating}
          className={`h-10 w-10 shrink-0 rounded-xl transition-all ${
            prompt.trim() && !isGenerating
              ? "bg-accent text-graphite hover:bg-accent"
              : "bg-graphite text-parchment/40"
          }`}
        >
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}