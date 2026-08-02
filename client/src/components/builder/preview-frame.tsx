import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor, Smartphone, Tablet, Eye, Code2, Copy, Check } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SectionFlash } from "@/lib/section-flash";

interface PreviewFrameProps {
  html: string;
  css: string;
  device: "desktop" | "tablet" | "mobile";
  onDeviceChange: (device: "desktop" | "tablet" | "mobile") => void;
  /** Section being touched by the chat agent: gold outline + badge on the
   *  matching [data-section-key] inside the iframe while a tool runs. */
  flash?: SectionFlash | null;
}

// Tool-theater styles injected into the preview document. The srcDoc iframe is
// same-origin, so the flash effect toggles the class directly on the section.
// Values are literal, not tokens: this CSS crosses into the iframe, where the
// app's custom properties do not exist. Keep the gold in step with
// --crowe-gold (#3b82f6) in styles/crowe/colors.css.
const FLASH_CSS = `
[data-section-key].cw-flash { position: relative; outline: 2px solid #3b82f6; outline-offset: -2px; animation: cw-flash-pulse 1.4s ease-in-out infinite; }
[data-section-key].cw-flash::before { content: attr(data-cw-flash-label); position: absolute; top: 12px; left: 12px; z-index: 60; padding: 5px 11px; border: 1px solid #3b82f6; border-radius: 999px; background: rgba(4, 16, 31, 0.92); color: #3b82f6; font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; text-transform: uppercase; }
@keyframes cw-flash-pulse { 0%, 100% { outline-color: rgba(59, 130, 246, 0.95); } 50% { outline-color: rgba(59, 130, 246, 0.4); } }
`;

export function PreviewFrame({ html, css, device, onDeviceChange, flash }: PreviewFrameProps) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Apply/remove the flash inside the live iframe without reloading it.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll(".cw-flash").forEach((el) => {
      el.classList.remove("cw-flash");
      el.removeAttribute("data-cw-flash-label");
    });
    if (!flash) return;
    const el = doc.querySelector(`[data-section-key="${flash.target}"]`);
    if (!el) return; // structure changed mid-turn — degrade to no flash
    el.setAttribute("data-cw-flash-label", flash.label || "Updating");
    el.classList.add("cw-flash");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [flash]);

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
      ${FLASH_CSS}
    </style>
  </head>
  <body>
    ${html}
  </body>
</html>`,
    [html, css],
  );

  // A complete, copy-paste-ready standalone document.
  const fullHtml = useMemo(
    () =>
      `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <style>\n${css}\n  </style>\n</head>\n<body>\n${html}\n</body>\n</html>`,
    [html, css],
  );

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };

  const width = { desktop: "100%", tablet: "768px", mobile: "375px" }[device];

  const segBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active ? "bg-accent/15 text-accent" : "text-parchment/55 hover:text-parchment"
    }`;

  return (
    <div className="flex h-full flex-1 flex-col bg-graphite">
      {/* toolbar */}
      <div className="flex h-12 items-center justify-between border-b border-accent/15 bg-graphite-soft px-3">
        {/* left: view toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-accent/15 p-0.5">
          <button className={segBtn(view === "preview")} onClick={() => setView("preview")}>
            <Eye className="h-3.5 w-3.5" /> Preview
          </button>
          <button className={segBtn(view === "code")} onClick={() => setView("code")}>
            <Code2 className="h-3.5 w-3.5" /> Code
          </button>
        </div>

        {/* center: device tabs (preview only) */}
        {view === "preview" ? (
          <Tabs value={device} onValueChange={(v) => onDeviceChange(v as any)}>
            <TabsList className="h-8 bg-graphite">
              <TabsTrigger value="desktop"><Monitor className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="tablet"><Tablet className="h-4 w-4" /></TabsTrigger>
              <TabsTrigger value="mobile"><Smartphone className="h-4 w-4" /></TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-parchment/40">
            Generated HTML + CSS
          </span>
        )}

        {/* right: copy (code view) */}
        <div className="flex w-[120px] justify-end">
          {view === "code" && (
            <button
              onClick={() => copy("all", fullHtml)}
              className="flex items-center gap-1.5 rounded-md border border-accent/20 px-2.5 py-1 text-xs font-medium text-parchment/70 transition-colors hover:border-accent/40 hover:text-accent"
            >
              {copied === "all" ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
              {copied === "all" ? "Copied" : "Copy file"}
            </button>
          )}
        </div>
      </div>

      {view === "preview" ? (
        <div className="flex flex-1 justify-center overflow-auto py-8">
          <div
            className="origin-top bg-white shadow-2xl transition-all duration-500 ease-in-out"
            style={{ width, height: device === "desktop" ? "100%" : "800px", minHeight: "100%" }}
          >
            <iframe
              ref={frameRef}
              title="Preview"
              srcDoc={srcDoc}
              className="h-full w-full border-none"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-auto p-5">
          {[
            { label: "index.html (body)", text: html },
            { label: "styles.css", text: css },
          ].map((block) => (
            <div key={block.label} className="overflow-hidden rounded-xl border border-accent/15 bg-graphite-soft">
              <div className="flex items-center justify-between border-b border-accent/15 px-4 py-2">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-accent/80">{block.label}</span>
                <button
                  onClick={() => copy(block.label, block.text)}
                  className="flex items-center gap-1.5 text-[0.7rem] text-parchment/55 transition-colors hover:text-accent"
                >
                  {copied === block.label ? <Check className="h-3 w-3 text-accent" /> : <Copy className="h-3 w-3" />}
                  {copied === block.label ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-[42vh] overflow-auto p-4 font-mono text-[0.72rem] leading-relaxed text-parchment/80">
                <code>{block.text}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
