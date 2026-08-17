import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp } from "lucide-react";
import { BuildFrame } from "@/components/showcase";
import { Reveal } from "@/components/reveal";
import { STARTERS } from "@/lib/starters";

const STEPS = [
  {
    n: "01",
    title: "Describe the business",
    body: "Say what you do, where you work, and who you serve. One useful sentence is enough.",
  },
  {
    n: "02",
    title: "Shape the first draft",
    body: "The site appears in seconds. Refine the writing, sections, imagery, and tone by talking to it.",
  },
  {
    n: "03",
    title: "Publish, then improve",
    body: "Hosting is included. After launch, the site finds weak sections and tests stronger versions.",
  },
];

const BEHAVIOURS = [
  {
    k: "Watches",
    body: "Reads which sections earn attention and which lose it, using real visits rather than guesses.",
  },
  {
    k: "Tests",
    body: "Writes a stronger version of the weakest section and runs an honest split against the original.",
  },
  {
    k: "Keeps",
    body: "Promotes the winner, retires the loser, and moves to the next opportunity. You stay in control.",
  },
];

const OUTPUTS = [
  {
    id: "bakery",
    label: "Rye & Ember",
    category: "Neighborhood bakery",
    src: "/showcase/bakery.webp",
  },
  {
    id: "trades",
    label: "Halvorsen Plumbing",
    category: "Local service company",
    src: "/showcase/trades.webp",
  },
  {
    id: "studio",
    label: "Meridian Yoga",
    category: "Movement studio",
    src: "/showcase/studio.webp",
  },
] as const;

const TYPE_MS = 26;
const HOLD_MS = 2600;

function useTypingPlaceholder(idle: boolean) {
  const [typed, setTyped] = useState(STARTERS[0].prompt);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!idle || reduced.current) {
      setTyped(STARTERS[0].prompt);
      return;
    }
    let starter = 0;
    let pos = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = STARTERS[starter % STARTERS.length].prompt;
      pos += 1;
      setTyped(full.slice(0, pos));
      if (pos >= full.length) {
        starter += 1;
        pos = 0;
        timer = setTimeout(tick, HOLD_MS);
      } else {
        timer = setTimeout(tick, TYPE_MS);
      }
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [idle]);

  return typed;
}

export default function Home() {
  const [, navigate] = useLocation();
  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);
  const placeholder = useTypingPlaceholder(!focused && prompt === "");

  const start = (value: string) => {
    const text = value.trim();
    if (!text) return;
    navigate(`/builder?prompt=${encodeURIComponent(text)}`);
  };

  return (
    <Layout>
      <div className="bg-paper text-ink">
        {/* The product and the prompt share the first viewport. */}
        <section className="relative overflow-hidden border-b border-paper-line">
          <div aria-hidden className="editorial-orbit absolute -right-44 -top-56 h-[42rem] w-[42rem] rounded-full" />
          <div className="container relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 lg:pb-24 lg:pt-24">
            <div className="grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <p className="rise font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
                  The living website
                </p>
                <h1
                  className="rise mt-6 max-w-[11ch] font-display text-[clamp(3.3rem,6.5vw,5.8rem)] font-medium leading-[0.94] tracking-[-0.038em] text-ink"
                  style={{ ["--d" as any]: "60ms" }}
                >
                  One sentence.
                  <br />
                  A finished site.
                </h1>
                <p
                  className="rise mt-7 max-w-lg text-[1.08rem] leading-[1.7] text-warm-dim"
                  style={{ ["--d" as any]: "110ms" }}
                >
                  Describe the business. The builder designs the page, writes the
                  copy, generates the imagery, and publishes it. Then the live site
                  keeps testing what works.
                </p>

                <div
                  className="rise mt-9 rounded-[14px] bg-ink p-3 text-left shadow-[0_24px_70px_rgba(26,23,20,0.18)]"
                  style={{ ["--d" as any]: "160ms" }}
                >
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        start(prompt);
                      }
                    }}
                    rows={3}
                    placeholder={placeholder}
                    className="w-full resize-none bg-transparent px-3 py-3 text-[1.02rem] leading-relaxed text-parchment outline-none placeholder:text-parchment/42"
                  />
                  <div className="flex items-center justify-between gap-4 px-2 pb-0.5">
                    <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-parchment/38">
                      Free to start · no card · ⌘↵
                    </span>
                    <Button
                      onClick={() => start(prompt)}
                      disabled={!prompt.trim()}
                      className="h-10 shrink-0 rounded-md bg-accent px-5 font-semibold text-on-accent hover:bg-accent-soft disabled:opacity-45"
                    >
                      Build it
                      <ArrowUp className="ml-1.5 h-4 w-4 rotate-45" />
                    </Button>
                  </div>
                </div>

                <div
                  className="rise mt-6 flex flex-wrap items-center gap-x-5 gap-y-2.5"
                  style={{ ["--d" as any]: "210ms" }}
                >
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-warm-dim/65">
                    Start with
                  </span>
                  {STARTERS.slice(0, 3).map((starter) => (
                    <button
                      key={starter.prompt}
                      onClick={() => start(starter.prompt)}
                      title={starter.prompt}
                      className="border-b border-paper-line pb-0.5 text-sm text-warm-dim transition-colors duration-100 hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {starter.short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rise lg:pt-3" style={{ ["--d" as any]: "120ms" }}>
                <div className="relative rounded-[18px] bg-graphite p-4 text-parchment shadow-[0_35px_90px_rgba(26,23,20,0.24)] sm:p-5">
                  <div className="mb-4 flex items-center justify-between border-b border-white/[0.08] pb-3">
                    <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-accent">
                      Live product
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-parchment/38">
                      <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                      Building now
                    </span>
                  </div>
                  <BuildFrame />
                </div>
                <div className="mt-4 flex items-center justify-between gap-4 px-1">
                  <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-warm-dim/70">
                    Actual renderer output
                  </p>
                  <p className="text-sm text-warm-dim">Three businesses. Three systems.</p>
                </div>
              </div>
            </div>

            <div className="mt-16 grid border-y border-paper-line py-5 text-sm text-warm-dim sm:grid-cols-3">
              {["Hosting included", "Publish on the free plan", "No template lock-in"].map(
                (item, index) => (
                  <div
                    key={item}
                    className={`flex items-center gap-3 py-2 ${
                      index > 0 ? "sm:border-l sm:border-paper-line sm:pl-8" : ""
                    }`}
                  >
                    <span className="font-mono text-[0.6rem] text-accent">0{index + 1}</span>
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        {/* A visual portfolio, not a claim about visual quality. */}
        <section className="bg-paper-deep py-24">
          <div className="container mx-auto max-w-6xl px-6">
            <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
              <Reveal>
                <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
                  Real output
                </p>
                <h2 className="mt-5 max-w-md font-display text-[clamp(2.5rem,4.8vw,4rem)] font-medium leading-[1] tracking-[-0.03em] text-ink">
                  The business changes. The design follows.
                </h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="max-w-xl text-[1.02rem] leading-[1.7] text-warm-dim lg:ml-auto">
                  These are not theme previews. Each came from the production
                  renderer with a different layout, type system, palette, and
                  generated photography.
                </p>
              </Reveal>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {OUTPUTS.map((output, index) => (
                <Reveal key={output.id} delay={index * 60}>
                  <article className="group overflow-hidden border border-paper-line bg-paper-raised shadow-[0_12px_35px_rgba(26,23,20,0.08)]">
                    <div className="flex items-center gap-1.5 bg-ink px-3 py-2.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-parchment/25" />
                      <span className="h-1.5 w-1.5 rounded-full bg-parchment/25" />
                      <span className="h-1.5 w-1.5 rounded-full bg-parchment/25" />
                    </div>
                    <div className="aspect-[4/3] overflow-hidden">
                      <img
                        src={output.src}
                        width={1600}
                        height={1500}
                        loading="lazy"
                        decoding="async"
                        alt={`${output.label}, a website built with Web Builder`}
                        className="h-full w-full object-cover object-top transition-transform duration-[280ms] ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.015] motion-reduce:transition-none"
                      />
                    </div>
                    <div className="flex items-end justify-between gap-4 border-t border-paper-line px-5 py-4">
                      <div>
                        <h3 className="font-display text-xl font-medium text-ink">{output.label}</h3>
                        <p className="mt-1 text-sm text-warm-dim">{output.category}</p>
                      </div>
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-accent-dim">
                        0{index + 1}
                      </span>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* The dark band previews the product surface and creates page rhythm. */}
        <section id="how-it-works" className="scroll-mt-20 bg-graphite py-24 text-parchment">
          <div className="container mx-auto max-w-6xl px-6">
            <Reveal>
              <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent">
                From prompt to published
              </p>
            </Reveal>
            <div className="mt-10 grid border-t border-white/[0.1] lg:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal
                  key={step.n}
                  delay={index * 60}
                  className={
                    index > 0 ? "lg:border-l lg:border-white/[0.1] lg:pl-8" : ""
                  }
                >
                  <div className="py-9 lg:pr-8">
                    <span className="font-mono text-[0.62rem] text-accent">{step.n}</span>
                    <h3 className="mt-6 font-display text-[1.8rem] font-medium leading-tight text-parchment">
                      {step.title}
                    </h3>
                    <p className="mt-4 text-[0.96rem] leading-relaxed text-parchment/55">
                      {step.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-paper-line bg-paper py-24">
          <div className="container mx-auto grid max-w-6xl gap-14 px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <Reveal>
              <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
                The living site
              </p>
              <h2 className="mt-5 max-w-md font-display text-[clamp(2.5rem,4.8vw,4rem)] font-medium leading-[1] tracking-[-0.03em] text-ink">
                Launch is the first version.
              </h2>
              <p className="mt-6 max-w-md text-[1rem] leading-[1.7] text-warm-dim">
                Most builders hand over a page and stop. This one stays on the
                job, learns from real visits, and proposes the next improvement.
              </p>
              <Button
                onClick={() => navigate("/builder")}
                className="mt-8 h-11 rounded-md bg-ink px-6 font-semibold text-paper hover:bg-ink/90"
              >
                Start building
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Reveal>

            <div className="border border-paper-line bg-paper-raised shadow-[0_12px_35px_rgba(26,23,20,0.07)]">
              {BEHAVIOURS.map((behaviour, index) => (
                <Reveal key={behaviour.k} delay={index * 60}>
                  <div
                    className={`grid gap-4 px-6 py-7 sm:grid-cols-[8rem_1fr] sm:px-8 ${
                      index > 0 ? "border-t border-paper-line" : ""
                    }`}
                  >
                    <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-accent-dim">
                      {behaviour.k}
                    </h3>
                    <p className="text-[0.96rem] leading-relaxed text-warm-dim">
                      {behaviour.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-paper-deep py-24">
          <div className="container mx-auto grid max-w-6xl gap-14 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <Reveal>
              <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
                For agents
              </p>
              <h2 className="mt-5 max-w-lg font-display text-[clamp(2.4rem,4.6vw,3.8rem)] font-medium leading-[1.01] tracking-[-0.03em] text-ink">
                One call in. One live URL out.
              </h2>
              <p className="mt-6 max-w-lg text-[1rem] leading-[1.7] text-warm-dim">
                Connect over MCP or raw HTTP. Pay with USDC over x402, without an
                account or API key. Payment settles only after the site is live.
              </p>
              <a
                href="/llms.txt"
                className="mt-7 inline-flex items-center gap-2 border-b border-accent pb-1 font-mono text-[0.66rem] uppercase tracking-[0.18em] text-accent-dim"
              >
                Read /llms.txt
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </Reveal>
            <Reveal delay={80}>
              <div className="overflow-hidden rounded-[12px] bg-graphite text-parchment shadow-[0_24px_70px_rgba(26,23,20,0.18)]">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3">
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-accent">
                    Agent session
                  </span>
                  <span className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-parchment/35">
                    Base · USDC · x402
                  </span>
                </div>
                <pre className="overflow-x-auto p-6 font-mono text-[0.75rem] leading-[1.8] text-parchment/75 sm:p-8">
{`POST /v1/agent/sites
{ "prompt": "a site for a Phoenix mycology farm" }

402 Payment Required
POST again + X-PAYMENT

{ "siteUrl": "…", "claimToken": "…" }`}
                </pre>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="border-t border-paper-line bg-paper py-28">
          <div className="container mx-auto max-w-6xl px-6">
            <Reveal>
              <div className="grid gap-9 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
                    Start with the sentence
                  </p>
                  <h2 className="mt-5 max-w-3xl font-display text-[clamp(3rem,6vw,5.4rem)] font-medium leading-[0.96] tracking-[-0.035em] text-ink">
                    Your next site can be live today.
                  </h2>
                </div>
                <Button
                  onClick={() => navigate("/builder")}
                  className="h-12 rounded-md bg-ink px-7 text-[1rem] font-semibold text-paper hover:bg-ink/90 lg:mb-2"
                >
                  Start building free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Reveal>
          </div>
        </section>
      </div>
    </Layout>
  );
}
