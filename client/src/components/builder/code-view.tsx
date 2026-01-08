import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check, Code2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CodeViewProps {
  html: string;
  css: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CodeView({ html, css, isOpen, onClose }: CodeViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const copyToClipboard = async (code: string, type: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(type);
    toast({ title: "Copied!", description: `${type} code copied to clipboard.` });
    setTimeout(() => setCopied(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-30 bg-background animate-in slide-in-from-bottom duration-300">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Code2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-heading font-semibold">Generated Code</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Code Tabs */}
        <Tabs defaultValue="html" className="flex-1 flex flex-col">
          <div className="px-4 pt-2 border-b border-border bg-background">
            <TabsList className="h-9">
              <TabsTrigger value="html" className="gap-2">
                <span className="text-orange-500 font-mono text-xs">&lt;/&gt;</span>
                HTML
              </TabsTrigger>
              <TabsTrigger value="css" className="gap-2">
                <span className="text-blue-500 font-mono text-xs">#</span>
                CSS
              </TabsTrigger>
              <TabsTrigger value="combined" className="gap-2">
                <span className="text-green-500 font-mono text-xs">*</span>
                Full Page
              </TabsTrigger>
            </TabsList>
          </div>
          
          <TabsContent value="html" className="flex-1 m-0 mt-0">
            <div className="relative h-full">
              <Button
                variant="outline"
                size="sm"
                className="absolute top-4 right-4 z-10 gap-2"
                onClick={() => copyToClipboard(html, "HTML")}
              >
                {copied === "HTML" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === "HTML" ? "Copied!" : "Copy"}
              </Button>
              <ScrollArea className="h-full">
                <pre className="p-4 text-sm font-mono bg-muted/20 min-h-full">
                  <code className="text-foreground whitespace-pre-wrap">{html}</code>
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>
          
          <TabsContent value="css" className="flex-1 m-0 mt-0">
            <div className="relative h-full">
              <Button
                variant="outline"
                size="sm"
                className="absolute top-4 right-4 z-10 gap-2"
                onClick={() => copyToClipboard(css, "CSS")}
              >
                {copied === "CSS" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === "CSS" ? "Copied!" : "Copy"}
              </Button>
              <ScrollArea className="h-full">
                <pre className="p-4 text-sm font-mono bg-muted/20 min-h-full">
                  <code className="text-foreground whitespace-pre-wrap">{css}</code>
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>
          
          <TabsContent value="combined" className="flex-1 m-0 mt-0">
            <div className="relative h-full">
              <Button
                variant="outline"
                size="sm"
                className="absolute top-4 right-4 z-10 gap-2"
                onClick={() => copyToClipboard(generateFullPage(html, css), "Full")}
              >
                {copied === "Full" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied === "Full" ? "Copied!" : "Copy"}
              </Button>
              <ScrollArea className="h-full">
                <pre className="p-4 text-sm font-mono bg-muted/20 min-h-full">
                  <code className="text-foreground whitespace-pre-wrap">{generateFullPage(html, css)}</code>
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function generateFullPage(html: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Website</title>
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
}
