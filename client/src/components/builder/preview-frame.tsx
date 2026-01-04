import { useRef, useEffect } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PreviewFrameProps {
  html: string;
  css: string;
  device: "desktop" | "tablet" | "mobile";
  onDeviceChange: (device: "desktop" | "tablet" | "mobile") => void;
}

export function PreviewFrame({ html, css, device, onDeviceChange }: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                ${css}
                /* Reset & Base Styles for Preview */
                body { margin: 0; font-family: system-ui, sans-serif; }
                * { box-sizing: border-box; }
              </style>
              <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
            </head>
            <body>
              ${html}
            </body>
          </html>
        `);
        doc.close();
      }
    }
  }, [html, css]);

  const width = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  }[device];

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/20">
      <div className="h-12 border-b border-border flex items-center justify-center bg-background px-4">
        <Tabs value={device} onValueChange={(v) => onDeviceChange(v as any)}>
          <TabsList className="h-8">
            <TabsTrigger value="desktop"><Monitor className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="tablet"><Tablet className="h-4 w-4" /></TabsTrigger>
            <TabsTrigger value="mobile"><Smartphone className="h-4 w-4" /></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      
      <div className="flex-1 overflow-auto flex justify-center py-8">
        <div 
          className="bg-white shadow-2xl transition-all duration-500 ease-in-out origin-top"
          style={{ width: width, height: device === "desktop" ? "100%" : "800px", minHeight: "100%" }}
        >
          <iframe
            ref={iframeRef}
            title="Preview"
            className="w-full h-full border-none"
            sandbox="allow-scripts"
          />
        </div>
      </div>
    </div>
  );
}