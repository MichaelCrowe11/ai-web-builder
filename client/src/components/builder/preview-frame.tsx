import { useMemo } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PreviewFrameProps {
  html: string;
  css: string;
  device: "desktop" | "tablet" | "mobile";
  onDeviceChange: (device: "desktop" | "tablet" | "mobile") => void;
}

export function PreviewFrame({ html, css, device, onDeviceChange }: PreviewFrameProps) {
  // Build the full document and feed it via srcDoc. This renders correctly under
  // a sandbox without allow-same-origin (contentDocument.write() returns null
  // when the iframe is cross-origin, which left the preview permanently blank).
  const srcDoc = useMemo(
    () => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      ${css}
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`,
    [html, css],
  );

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
            title="Preview"
            srcDoc={srcDoc}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}