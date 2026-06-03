import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { useLocation } from "wouter";
import { useState } from "react";
import { Sparkles, Globe, Zap, ShieldCheck, ArrowUp } from "lucide-react";

// Crowe Logic AI Web Builder. Replit-Agent-style: a big central prompt is the
// hero. You describe a site and land straight in the workspace, building.
// Crowe identity (gold on graphite, parchment), clean modern sans (no serif).
const STARTERS = [
  "A cozy coffee shop in Tucson with a menu and online reservations",
  "A freelance photographer portfolio",
  "A local plumbing company with service booking",
  "An online store for handmade ceramics",
  "A yoga studio with a class schedule",
];

export default function Home() {
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState("");

  const start = (p: string) => {
    const text = p.trim();
    if (!text) return;
    navigate(`/builder?prompt=${encodeURIComponent(text)}`);
  };

  return (
    <Layout>
      <div className="bg-graphite text-parchment">
        {/* ============ PROMPT HERO (Replit-Agent style) ============ */}
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(52rem 30rem at 50% -12%, rgba(191,166,105,0.13), transparent 62%)" }}
          />
          <div className="container relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-20 pt-24 text-center lg:pt-28">
            <div className="rise mb-7 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-gold/90">
              <span className="h-1 w-1 animate-pulse rounded-full bg-gold" />
              Crowe Logic · AI Web Builder
            </div>

            <h1
              className="rise text-[clamp(2.2rem,5vw,3.7rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-parchment"
              style={{ ["--d" as any]: "60ms" }}
            >
              What do you want to build?
            </h1>
            <p
              className="rise mt-4 max-w-lg text-[1.05rem] leading-relaxed text-parchment/55"
              style={{ ["--d" as any]: "140ms" }}
            >
              Describe your business in a sentence. We design it, write the copy,
              and put it live on the web — with your own domain.
            </p>

            {/* THE COMPOSER — the hero element */}
            <div className="rise mt-10 w-full" style={{ ["--d" as any]: "220ms" }}>
              <div className="group rounded-2xl border border-gold/25 bg-graphite-soft/80 p-2.5 text-left shadow-[0_30px_90px_-36px_rgba(191,166,105,0.5)] backdrop-blur-sm transition-colors focus-within:border-gold/50">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start(prompt);
                  }}
                  rows={3}
                  placeholder="e.g. a neighborhood coffee shop in Tucson with a menu and online reservations"
                  className="w-full resize-none bg-transparent px-3.5 py-3 text-[1.05rem] leading-relaxed text-parchment outline-none placeholder:text-parchment/35"
                  autoFocus
                />
                <div className="flex items-center justify-between px-2 pb-0.5">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/35">
                    Free to start · no card · ⌘↵ to build
                  </span>
                  <Button
                    onClick={() => start(prompt)}
                    disabled={!prompt.trim()}
                    className="h-11 rounded-xl bg-gold px-6 font-semibold text-graphite transition-all hover:shadow-[0_0_34px_-8px_rgba(191,166,105,0.75)] disabled:opacity-40"
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Build it
                    <ArrowUp className="ml-1 h-4 w-4 rotate-45" />
                  </Button>
                </div>
              </div>

              {/* starter chips */}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => start(s)}
                    className="rounded-full border border-gold/15 bg-graphite-soft/50 px-3.5 py-1.5 text-xs text-parchment/60 transition-colors hover:border-gold/40 hover:text-gold"
                  >
                    {s.length > 42 ? s.slice(0, 40) + "…" : s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS (clean, compact) ============ */}
        <section className="border-t border-gold/10 py-20">
          <div className="container mx-auto px-6">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-gold/15 bg-gold/15 md:grid-cols-3">
              {[
                { n: "01", icon: Zap, title: "Describe it", body: "Tell us what your business does in one sentence — or pick a starter above." },
                { n: "02", icon: Globe, title: "Refine it", body: "A polished site appears in seconds. Adjust the look and copy with a tap in the workspace." },
                { n: "03", icon: ShieldCheck, title: "Ship it", body: "Publish with one click. Hosting's included. Connect your own domain when you're ready." },
              ].map((f) => (
                <div key={f.n} className="group bg-graphite p-8 transition-colors duration-300 hover:bg-graphite-soft">
                  <div className="flex items-center justify-between">
                    <f.icon className="h-6 w-6 text-gold" strokeWidth={1.6} />
                    <span className="font-mono text-xs text-gold/70">{f.n}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-parchment">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-parchment/55">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
