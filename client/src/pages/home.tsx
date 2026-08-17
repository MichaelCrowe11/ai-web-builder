import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { BuildFrame } from "@/components/showcase";
import { Reveal } from "@/components/reveal";
import { STARTERS } from "@/lib/starters";

// AI Web Builder. The hero is a working demonstration: the prompt on the left,
// and on the right the product visibly building real sites, above the fold,
// before a single word of marketing is read. The positioning leads with the
// differentiator, a LIVING site that keeps testing and improving itself, not
// "generate a page and leave."
//
// The page is deliberately NOT a stack of centred blocks with three-card grids
// and an icon in every card. That shape is the house style of a generated app,
// and a product whose whole claim is that its output does not look generated
// cannot afford to look generated itself. So: a split hero where the proof sits
// beside the promise, then editorial rows with hanging numerals, a split with a
// sticky column, and hairline rules doing the work boxes were doing.

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

const TYPE_MS = 26;
const HOLD_MS = 2600;

/**
 * The composer placeholder types the starter prompts to itself while the field
 * is idle, so the first thing a visitor sees is the product being used. It
 * stops the moment they focus or type, and reduced motion gets a static
 * example.
 */
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

  const start = (p: string) => {
    const text = p.trim();
    if (!text) return;
    navigate(`/builder?prompt=${encodeURIComponent(text)}`);
  };

  return (
    <Layout>
      <div className="bg-graphite text-parchment">
        {/* ============ SPLIT HERO: the promise beside the proof ============ */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="ground-grid pointer-events-none absolute inset-0" />
          {/* Atmosphere: two large accent blooms, one seated behind the frame,
              one low on the text side. Accent blue only; violet is mark-only. */}
          <div aria-hidden className="aurora hero-bloom-a pointer-events-none absolute inset-0" />
          <div
            aria-hidden
            className="aurora hero-bloom-b pointer-events-none absolute inset-0"
            style={{ animationDelay: "-9s" }}
          />

          <div className="container relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 lg:pt-24">
            <div className="grid items-center gap-x-14 gap-y-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]">
              {/* Left: the prompt. */}
              <div className="flex flex-col items-start text-left">
                <h1 className="rise font-display text-[clamp(2.7rem,5vw,4.4rem)] font-medium leading-[1.02] tracking-[-0.025em] text-parchment">
                  What do you
                  <br />
                  want to <em className="accent-sheen not-italic">build</em>?
                </h1>
                <p
                  className="rise mt-6 max-w-md text-[1.08rem] leading-relaxed text-parchment/60"
                  style={{ ["--d" as any]: "80ms" }}
                >
                  Describe your business in a sentence. You get a finished site
                  that goes on improving itself after it is live.
                </p>

                {/* The composer. The one element that gets a light source. */}
                <div className="rise relative mt-9 w-full" style={{ ["--d" as any]: "160ms" }}>
                  <div aria-hidden className="composer-bloom pointer-events-none absolute -inset-x-12 -inset-y-10" />
                  <div className="crowe-raised relative rounded-xl p-2.5 text-left transition-[border-color,box-shadow] duration-150 focus-within:border-accent/55 focus-within:shadow-[var(--crowe-z3),var(--crowe-accent-glow)]">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start(prompt);
                      }}
                      rows={3}
                      placeholder={placeholder}
                      className="w-full resize-none bg-transparent px-3.5 py-3 text-[1.05rem] leading-relaxed text-parchment outline-none placeholder:text-parchment/40"
                    />
                    <div className="flex items-center justify-between gap-4 px-2 pb-0.5">
                      <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/35">
                        Free to start · no card · ⌘↵ to build
                      </span>
                      <Button
                        onClick={() => start(prompt)}
                        disabled={!prompt.trim()}
                        className="btn-jewel h-10 shrink-0 rounded-lg bg-accent px-5 font-semibold text-on-accent disabled:opacity-55"
                      >
                        Build it
                        <ArrowUp className="ml-1.5 h-4 w-4 rotate-45" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Openers as text, not a field of pills. */}
                <div
                  className="rise mt-6 flex flex-wrap items-center gap-x-5 gap-y-2.5"
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

              {/* Right: the proof. The product building real sites, above the
                  fold, on a loop. */}
              <BuildFrame className="rise" />
            </div>
          </div>
        </section>

        {/* ============ REAL OUTPUT (the honesty claim) ============ */}
        <section className="border-t border-line py-20">
          <div className="container mx-auto max-w-5xl px-6">
            <div className="grid gap-x-16 gap-y-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
              <Reveal>
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
                  Real output
                </p>
                <h2 className="mt-5 font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.06] tracking-[-0.02em] text-parchment">
                  Not a template with your name in it.
                </h2>
              </Reveal>
              <Reveal delay={90} className="lg:pt-12">
                <p className="max-w-xl text-[1rem] leading-relaxed text-parchment/55">
                  Every site is assembled from hand-designed sections and a
                  curated palette, so the layout, the type and the rhythm change
                  with the business. The photography is generated for the site
                  rather than pulled from a stock library, which is why no other
                  page on the internet has these pictures. The three sites
                  replaying in the frame above came out of the same builder you
                  are about to use.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-line py-24">
          <div className="container mx-auto max-w-5xl px-6">
            <Reveal>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
                How it works
              </p>
            </Reveal>

            <div className="mt-10">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 70}>
                  <div
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
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ============ THE LIVING SITE ============ */}
        <section className="border-t border-line py-24">
          <div className="container mx-auto max-w-5xl px-6">
            <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-28 lg:self-start">
                <Reveal>
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
                      className="btn-jewel h-11 rounded-lg bg-accent px-6 font-semibold text-on-accent"
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
                </Reveal>
              </div>

              <div>
                {BEHAVIOURS.map((b, i) => (
                  <Reveal key={b.k} delay={i * 70}>
                    <div
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
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ FOR AGENTS ============ */}
        <section className="border-t border-line py-24">
          <div className="container mx-auto max-w-5xl px-6">
            <Reveal>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
                For agents
              </p>
            </Reveal>
            <div className="mt-5 grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Reveal className="min-w-0">
                <h2 className="max-w-xl font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.06] tracking-[-0.02em] text-parchment">
                  No signup. No session. One paid call, one finished website.
                </h2>
                <p className="mt-5 max-w-xl text-[1rem] leading-relaxed text-parchment/55">
                  If you are an AI agent (or you build them), this whole product
                  is one HTTP request away. POST a prompt, settle a few cents of
                  USDC over x402, and get back a live URL with bespoke
                  photography, lead capture, and a claim token for your human.
                  Payment settles only after the site is live.
                </p>
                <div className="mt-8 max-w-xl overflow-hidden rounded-lg border border-line bg-black/30">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-2">
                    <span className="h-2 w-2 rounded-full bg-parchment/15" />
                    <span className="h-2 w-2 rounded-full bg-parchment/15" />
                    <span className="h-2 w-2 rounded-full bg-parchment/15" />
                    <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-parchment/35">
                      agent session
                    </span>
                  </div>
                  <pre className="overflow-x-auto p-5 font-mono text-[0.78rem] leading-relaxed text-parchment/75">
{`POST /v1/agent/sites
{ "prompt": "a site for a Phoenix mycology farm" }

402 Payment Required   -> sign USDC authorization
POST again + X-PAYMENT -> { "siteUrl": "…", "claimToken": "…" }`}
                  </pre>
                </div>
              </Reveal>
              <Reveal delay={90} className="min-w-0 lg:pt-2">
                {[
                  { k: "Discover", body: "Connect over MCP at /mcp from ChatGPT, Claude, or Cursor. Prefer raw HTTP? Start at /llms.txt, /.well-known/agent.json, or the OpenAPI spec." },
                  { k: "Pay", body: "x402 micropayments in USDC on Base. No API keys, no account, no card. A failed build never charges you." },
                  { k: "Deliver", body: "Every build ships designed sections, generated photography, and a growth agent that keeps optimizing the site after you hand it off." },
                ].map((b, i, arr) => (
                  <div
                    key={b.k}
                    className={`rule-row grid gap-y-2 py-7 ${
                      i === arr.length - 1 ? "border-b border-line" : ""
                    }`}
                  >
                    <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-parchment/70">
                      {b.k}
                    </h3>
                    <p className="text-[0.95rem] leading-relaxed text-parchment/55">
                      {b.body}
                    </p>
                  </div>
                ))}
                <a
                  href="/llms.txt"
                  className="mt-6 inline-block font-mono text-[0.75rem] uppercase tracking-[0.18em] text-accent underline-offset-4 hover:underline"
                >
                  Read /llms.txt →
                </a>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ============ CLOSER ============ */}
        <section className="relative overflow-hidden border-t border-line">
          <div aria-hidden className="closer-bloom pointer-events-none absolute inset-0" />
          <div className="container relative z-10 mx-auto max-w-5xl px-6 py-28">
            <Reveal>
              <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
                <h2 className="max-w-2xl font-display text-[clamp(2.2rem,4.6vw,3.4rem)] font-medium leading-[1.04] tracking-[-0.022em] text-parchment">
                  Your next site is one
                  <br />
                  sentence away.
                </h2>
                <div className="flex shrink-0 flex-wrap items-center gap-4 md:pb-2">
                  <Button
                    onClick={() => navigate("/builder")}
                    className="btn-jewel h-12 rounded-lg bg-accent px-7 text-[1rem] font-semibold text-on-accent"
                  >
                    Start building free
                  </Button>
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-parchment/35">
                    No card required
                  </span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </div>
    </Layout>
  );
}
