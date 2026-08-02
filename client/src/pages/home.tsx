import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { useLocation } from "wouter";
import { useState } from "react";
import { Sparkles, Globe, Zap, ArrowUp, Eye, FlaskConical, TrendingUp } from "lucide-react";
import { Showcase } from "@/components/showcase";

// Crowe Logic AI Web Builder. The hero is a big central prompt (Replit-Agent
// style): describe a business and land straight in the workspace, building.
// The positioning leads with the differentiator — a LIVING site that keeps
// testing and improving itself — not just "generate a page and leave."
// Crowe identity (gold on graphite, parchment), clean modern sans.
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
            style={{ background: "radial-gradient(52rem 30rem at 50% -12%, rgba(210,173,98,0.13), transparent 62%)" }}
          />
          <div className="container relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-20 pt-24 text-center lg:pt-28">
            <div className="rise mb-7 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-gold/90">
              <span className="h-1 w-1 animate-pulse rounded-full bg-gold" />
              Crowe Logic · AI Web Builder
            </div>

            <h1
              className="rise font-display text-[clamp(2.2rem,5vw,3.7rem)] font-medium leading-[1.04] tracking-[-0.02em] text-parchment"
              style={{ ["--d" as any]: "60ms" }}
            >
              What do you want to build?
            </h1>
            <p
              className="rise mt-4 max-w-lg text-[1.05rem] leading-relaxed text-parchment/55"
              style={{ ["--d" as any]: "140ms" }}
            >
              Describe your business in a sentence. We design it, write the copy,
              and put it live. Then it keeps testing itself and improving to win
              you more customers.
            </p>

            {/* THE COMPOSER — the hero element */}
            <div className="rise mt-10 w-full" style={{ ["--d" as any]: "220ms" }}>
              <div className="group rounded-2xl border border-gold/25 bg-graphite-soft/80 p-2.5 text-left shadow-[0_30px_90px_-36px_rgba(210,173,98,0.5)] backdrop-blur-sm transition-colors focus-within:border-gold/50">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start(prompt);
                  }}
                  rows={2}
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
                    className="h-11 rounded-xl bg-gold px-6 font-semibold text-graphite transition-all hover:shadow-[0_0_34px_-8px_rgba(210,173,98,0.75)] disabled:opacity-40"
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

        {/* ============ PROOF: real rendered output ============
            Placed directly under the hero on purpose. The first question after
            "describe your business" is "and what do I get", and the answer used
            to be four hundred pixels of prose before anything was shown. */}
        <Showcase />

        {/* ============ HOW IT WORKS (clean, compact) ============ */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-gold/10 py-20">
          <div className="container mx-auto px-6">
            <div className="crowe-panel grid gap-px overflow-hidden rounded-2xl bg-line md:grid-cols-3">
              {[
                { n: "01", icon: Zap, title: "Describe it", body: "Tell us what your business does in one sentence, or pick a starter above." },
                { n: "02", icon: Globe, title: "Refine and ship it", body: "A polished site appears in seconds. Adjust the look and copy by chatting, then publish with one click. Hosting is included." },
                { n: "03", icon: TrendingUp, title: "Let it grow", body: "Once it is live, the site watches real visits and keeps improving its copy to convert more of them." },
              ].map((f) => (
                <div key={f.n} className="group bg-graphite-soft p-8 transition-colors duration-200 hover:bg-graphite-raised">
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

        {/* ============ THE LIVING SITE (the differentiator) ============ */}
        <section className="border-t border-gold/10 py-24">
          <div className="container mx-auto max-w-5xl px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold/90">The living site</p>
              <h2 className="mt-4 font-display text-[clamp(1.8rem,4vw,2.7rem)] font-medium leading-[1.08] tracking-[-0.02em] text-parchment">
                It does not just launch. It learns.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[1.02rem] leading-relaxed text-parchment/55">
                Most site builders hand you a page and walk away. Yours stays on
                the job. It sees how visitors move, tests sharper copy on the
                sections that underperform, and keeps the versions that win, so
                the site converts better over time without you touching it.
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                { icon: Eye, title: "Watches", body: "It reads which sections earn attention and which lose it, on real visits, not guesses." },
                { icon: FlaskConical, title: "Tests", body: "It proposes stronger copy for the weakest section and runs a clean, honest A/B split." },
                { icon: TrendingUp, title: "Improves", body: "It keeps the winning version and moves to the next weak spot. Your approval is one click." },
              ].map((c) => (
                <div key={c.title} className="crowe-panel crowe-lift rounded-2xl p-7">
                  <c.icon className="h-6 w-6 text-gold" strokeWidth={1.6} />
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-parchment">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-parchment/55">{c.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
              <Button
                onClick={() => navigate("/builder")}
                className="h-11 rounded-xl bg-gold px-7 font-semibold text-graphite transition-all hover:shadow-[0_0_34px_-8px_rgba(210,173,98,0.75)]"
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Start building free
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/pricing")}
                className="h-11 rounded-xl border-gold/30 px-7 text-parchment hover:bg-gold/10"
              >
                See pricing
              </Button>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
