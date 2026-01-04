import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Sparkles, Loader2, Paperclip } from "lucide-react";

interface PromptInputProps {
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
}

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
        {["Landing Page", "Portfolio", "SaaS Dashboard", "Blog"].map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => setPrompt(suggestion)}
            className="text-xs px-2.5 py-1 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap border border-border/50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}