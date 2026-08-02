import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { useLocation } from "wouter";
import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { Showcase } from "@/components/showcase";
import { STARTERS } from "@/lib/starters";

// AI Web Builder. The hero is a prompt: describe a business and land straight in
// the workspace, building. The positioning leads with the differentiator, a
// LIVING site that keeps testing and improving itself, not "generate a page and
// leave."
//
// The page is deliberately NOT a stack of centred blocks with three-card grids
// and an icon in every card. That shape, plus a radial glow behind the hero and
// a sparkle on every button, is the house style of a generated app, and a
// product whose whole claim is that its output does not look generated cannot
// afford to look generated itself. So: one centred element, the prompt, which
// earns it, then editorial rows with hanging numerals, a split with a sticky
// column, and hairline rules doing the work boxes were doing.

const STEPS = [
  {
    n: "01",
    title: "Describe it",
    body: "One sentence about your business: what you do, where, and for whom. Or take one of the openers above and change it later.",
  },
  {
    n: "02",
    title: "Refine and ship it",
    body: "A finished site appears in seconds. Change the copy, the sections and the look by talking to it, then publish. Hosting and the subdomain are included.",
  },
  {
    n: "03",
    title: "Let it grow",
    body: "Once it is live it watches real visits, finds the section losing people, and proposes a sharper version. You approve with one click.",
  },
];

const BEHAVIOURS = [
  {
    k: "Watches",
    body: "It reads which sections earn attention and which lose it, on real visits rather than guesses, and it knows which one is costing you the most.",
  },
  {
    k: "Tests",
    body: "It writes a stronger version of the weakest section and runs an honest split against the original. Nothing changes on your live site until one of them wins.",
  },
  {
    k: "Improves",
    body: "It keeps the winner, retires the loser, and moves to the next weak spot. The site you published in March is not the site working for you in June.",
  },
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
        {/* ============ PROMPT HERO ============ */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="ground-grid pointer-events-none absolute inset-0" />

          <div className="container relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-24 pt-24 text-center lg:pt-32">
            <h1 className="rise font-display text-[clamp(2.3rem,5.2vw,3.9rem)] font-medium leading-[1.03] tracking-[-0.022em] text-parchment">
              What do you want to build?
            </h1>
            <p
              className="rise mt-5 max-w-md text-[1.05rem] leading-relaxed text-parchment/55"
              style={{ ["--d" as any]: "80ms" }}
            >
              Describe your business in a sentence. You get a finished site that
              goes on improving itself after it is live.
            </p>

            {/* The composer. The one element that gets a light source. */}
            <div className="rise relative mt-11 w-full" style={{ ["--d" as any]: "160ms" }}>
              <div aria-hidden className="composer-bloom pointer-events-none absolute -inset-x-10 -inset-y-8" />
              <div className="crowe-raised relative rounded-xl p-2.5 text-left transition-colors duration-150 focus-within:border-accent/45">
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
                <div className="flex items-center justify-between gap-4 px-2 pb-0.5">
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/35">
                    Free to start · no card · ⌘↵ to build
                  </span>
                  <Button
                    onClick={() => start(prompt)}
                    disabled={!prompt.trim()}
                    className="h-10 shrink-0 rounded-lg bg-accent px-5 font-semibold text-on-accent transition-shadow hover:shadow-[var(--crowe-accent-glow)] disabled:opacity-35"
                  >
                    Build it
                    <ArrowUp className="ml-1.5 h-4 w-4 rotate-45" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Openers as text, not a field of pills. */}
            <div
              className="rise mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5"
              style={{ ["--d" as any]: "240ms" }}
            >
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-parchment/30">
                Or start from
              </span>
              {STARTERS.slice(0, 3).map((s) => (
                <button
                  key={s.prompt}
                  onClick={() => start(s.prompt)}
                  title={s.prompt}
                  className="border-b border-transparent pb-0.5 text-sm text-parchment/55 transition-colors duration-150 hover:border-accent/50 hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55"
                >
                  {s.short}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Proof, directly under the hero: the first question after "describe
            your business" is "and what do I get". */}
        <Showcase />

        {/* ============ HOW IT WORKS ============ */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-line py-24">
          <div className="container mx-auto max-w-5xl px-6">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
              How it works
            </p>

            <div className="mt-10">
              {STEPS.map((s, i) => (
                <div
                  key={s.n}
                  className={`rule-row grid gap-x-8 gap-y-3 py-9 md:grid-cols-[4.5rem_15rem_1fr] ${
                    i === STEPS.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <span className="font-display text-[1.6rem] leading-none text-accent/70">
                    {s.n}
                  </span>
                  <h3 className="font-display text-[1.45rem] leading-tight tracking-[-0.01em] text-parchment">
                    {s.title}
                  </h3>
                  <p className="max-w-xl text-[0.98rem] leading-relaxed text-parchment/55">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ THE LIVING SITE ============ */}
        <section className="border-t border-line py-24">
          <div className="container mx-auto max-w-5xl px-6">
            <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[22rem_1fr]">
              <div className="lg:sticky lg:top-28 lg:self-start">
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
                  The living site
                </p>
                <h2 className="mt-5 font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.06] tracking-[-0.02em] text-parchment">
                  It does not just launch. It learns.
                </h2>
                <p className="mt-5 text-[1rem] leading-relaxed text-parchment/55">
                  Most builders hand you a page and walk away. This one stays on
                  the job, and the difference compounds every month you leave it
                  running.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => navigate("/builder")}
                    className="h-11 rounded-lg bg-accent px-6 font-semibold text-on-accent transition-shadow hover:shadow-[var(--crowe-accent-glow)]"
                  >
                    Start building free
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/pricing")}
                    className="h-11 rounded-lg border-accent/30 px-6 text-parchment hover:bg-accent/10"
                  >
                    See pricing
                  </Button>
                </div>
              </div>

              <div>
                {BEHAVIOURS.map((b, i) => (
                  <div
                    key={b.k}
                    className={`rule-row grid gap-x-8 gap-y-2 py-8 sm:grid-cols-[9rem_1fr] ${
                      i === BEHAVIOURS.length - 1 ? "border-b border-line" : ""
                    }`}
                  >
                    <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-parchment/70">
                      {b.k}
                    </h3>
                    <p className="text-[0.98rem] leading-relaxed text-parchment/55">
                      {b.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
