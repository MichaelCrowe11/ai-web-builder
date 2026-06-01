import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowUpRight, Globe, Zap, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <Layout>
      {/* ============ HERO — dark ink, editorial, asymmetric ============ */}
      <section className="relative overflow-hidden bg-[hsl(24,14%,10%)] text-[hsl(40,38%,96%)]">
        {/* grain + warm glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            background:
              "radial-gradient(60rem 40rem at 80% -10%, hsla(16,78%,48%,0.22), transparent 60%), radial-gradient(50rem 50rem at 0% 110%, hsla(40,38%,80%,0.06), transparent 60%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        <div className="container relative z-10 mx-auto grid items-center gap-12 px-6 pb-24 pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pb-32 lg:pt-28">
          {/* Left: editorial copy */}
          <div>
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-white/70 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(16,78%,55%)]" />
              Live in minutes — not weekends
            </div>

            <h1 className="font-heading text-[clamp(2.8rem,7vw,5.5rem)] font-light leading-[0.95] tracking-[-0.02em]">
              Describe your
              <br />
              business.{" "}
              <span className="relative inline-block italic text-[hsl(16,78%,58%)]">
                We make
                <svg
                  className="absolute -bottom-2 left-0 w-full"
                  height="10"
                  viewBox="0 0 200 10"
                  preserveAspectRatio="none"
                  fill="none"
                >
                  <path
                    d="M2 7C40 2 160 2 198 6"
                    stroke="hsl(16,78%,52%)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <br />
              it <span className="italic text-[hsl(16,78%,58%)]">real.</span>
            </h1>

            <p className="mt-8 max-w-md text-lg leading-relaxed text-white/65">
              Tell us what you do in a sentence. We design a beautiful website,
              put it online, and connect your own domain — no code, no hosting,
              no headaches.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/builder">
                <Button
                  size="lg"
                  className="group h-14 rounded-full bg-[hsl(16,78%,50%)] px-8 text-base font-semibold text-white shadow-[0_8px_30px_-8px_hsla(16,78%,50%,0.7)] transition-all hover:bg-[hsl(16,78%,46%)] hover:shadow-[0_12px_40px_-8px_hsla(16,78%,50%,0.9)]"
                >
                  Build my website
                  <ArrowUpRight className="ml-1 h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Button>
              </Link>
              <span className="font-mono text-xs text-white/45">
                free to start · no card
              </span>
            </div>
          </div>

          {/* Right: the "paper artifact" — a website emerging from a prompt */}
          <div className="relative">
            <div className="rotate-[1.5deg] rounded-2xl border border-white/10 bg-[hsl(40,38%,96%)] p-3 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] transition-transform duration-500 hover:rotate-0">
              {/* browser chrome */}
              <div className="flex items-center gap-1.5 px-2 pb-3 pt-1">
                <span className="h-2.5 w-2.5 rounded-full bg-[hsl(16,60%,70%)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[hsl(40,40%,75%)]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[hsl(150,30%,70%)]" />
                <span className="ml-3 truncate font-mono text-[0.65rem] text-[hsl(24,14%,45%)]">
                  bean-there.ai-webbuilder.com
                </span>
              </div>
              {/* mini rendered site */}
              <div className="overflow-hidden rounded-lg bg-white text-[hsl(24,14%,12%)]">
                <div className="bg-[hsl(24,14%,12%)] px-6 py-10 text-center text-white">
                  <p className="font-heading text-3xl italic">Bean There</p>
                  <p className="mt-1 text-xs text-white/60">
                    Neighborhood coffee, roasted daily
                  </p>
                  <span className="mt-4 inline-block rounded-full bg-[hsl(16,78%,50%)] px-4 py-1.5 text-xs font-semibold">
                    Reserve a table
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {["Espresso", "Pour Over", "Cold Brew"].map((x) => (
                    <div key={x} className="rounded-md bg-[hsl(36,30%,94%)] p-3">
                      <div className="mb-2 h-10 rounded bg-[hsl(28,40%,84%)]" />
                      <p className="text-[0.6rem] font-semibold">{x}</p>
                      <p className="text-[0.55rem] text-[hsl(24,8%,45%)]">$4.50</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* prompt tag */}
            <div className="absolute -bottom-5 -left-4 max-w-[15rem] -rotate-2 rounded-xl border border-[hsl(32,16%,80%)] bg-white px-4 py-3 shadow-xl">
              <p className="font-mono text-[0.65rem] uppercase tracking-wider text-[hsl(16,78%,48%)]">
                your prompt
              </p>
              <p className="mt-1 text-sm leading-snug text-[hsl(24,14%,20%)]">
                "a cozy coffee shop in Tucson with online reservations"
              </p>
            </div>
          </div>
        </div>

        {/* marquee strip */}
        <div className="relative z-10 border-y border-white/10 bg-black/20 py-3">
          <div className="flex items-center gap-8 overflow-hidden px-6 font-mono text-xs uppercase tracking-[0.25em] text-white/40">
            {["Restaurants", "Portfolios", "Local services", "Online stores", "Events", "Studios", "Cafés"].map(
              (x) => (
                <span key={x} className="flex items-center gap-8 whitespace-nowrap">
                  {x} <span className="text-[hsl(16,78%,55%)]">✦</span>
                </span>
              ),
            )}
          </div>
        </div>
      </section>

      {/* ============ FEATURES — editorial, numbered, asymmetric ============ */}
      <section className="bg-[hsl(40,38%,96%)] py-24">
        <div className="container mx-auto px-6">
          <div className="mb-16 max-w-2xl">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-[hsl(16,78%,48%)]">
              How it works
            </p>
            <h2 className="font-heading text-[clamp(2rem,4vw,3.25rem)] font-light leading-[1.05] tracking-[-0.02em] text-[hsl(24,14%,12%)]">
              Three steps from a sentence to a site your customers can visit.
            </h2>
          </div>

          <div className="grid gap-px overflow-hidden rounded-2xl border border-[hsl(32,16%,84%)] bg-[hsl(32,16%,84%)] md:grid-cols-3">
            {[
              {
                n: "01",
                icon: Zap,
                title: "Describe it",
                body: "Tell us what your business does in one sentence — or pick a starter for your industry.",
              },
              {
                n: "02",
                icon: Sparkles,
                title: "Watch it build",
                body: "A polished, mobile-ready website appears in seconds. Tweak the look, regenerate, refine.",
              },
              {
                n: "03",
                icon: Globe,
                title: "Go live",
                body: "Publish with one click. Hosting's included. Connect your own domain when you're ready.",
              },
            ].map((f) => (
              <div
                key={f.n}
                className="group relative bg-[hsl(40,38%,97%)] p-8 transition-colors hover:bg-white"
              >
                <span className="font-mono text-sm text-[hsl(16,78%,50%)]">{f.n}</span>
                <f.icon className="mt-6 h-7 w-7 text-[hsl(24,14%,18%)]" strokeWidth={1.5} />
                <h3 className="mt-4 font-heading text-2xl font-medium text-[hsl(24,14%,12%)]">
                  {f.title}
                </h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-[hsl(28,8%,38%)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>

          {/* domain line — the differentiator */}
          <div className="mt-16 flex flex-col items-start justify-between gap-6 rounded-2xl bg-[hsl(24,14%,12%)] p-10 text-white md:flex-row md:items-center">
            <div>
              <p className="mb-2 font-mono text-xs uppercase tracking-[0.25em] text-[hsl(16,78%,58%)]">
                Your name, your site
              </p>
              <h3 className="font-heading text-2xl font-light md:text-3xl">
                Grab your own domain right here — we handle the technical setup.
              </h3>
            </div>
            <Link href="/builder">
              <Button
                size="lg"
                className="h-13 shrink-0 rounded-full bg-white px-7 font-semibold text-[hsl(24,14%,12%)] hover:bg-white/90"
              >
                Start building <ArrowUpRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
