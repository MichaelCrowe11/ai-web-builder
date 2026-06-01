import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowRight, Globe, Zap, ShieldCheck } from "lucide-react";

// Crowe Logic brand: gold (#bfa669) on graphite (#0b0b0c), parchment text.
// Source of truth: ~/BRAND.md. App chrome only — generated sites stay neutral.
export default function Home() {
  return (
    <Layout>
      <div className="bg-[#0b0b0c] text-[#e8e2cf]">
        {/* ============ HERO ============ */}
        <section className="relative overflow-hidden">
          {/* gold glow + grain */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(55rem 38rem at 78% -8%, rgba(191,166,105,0.16), transparent 60%), radial-gradient(40rem 40rem at 0% 110%, rgba(191,166,105,0.05), transparent 60%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-screen"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            }}
          />

          <div className="container relative z-10 mx-auto grid items-center gap-12 px-6 pb-24 pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-28">
            <div>
              {/* eyebrow pill (canonical primitive) */}
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#bfa669]/30 bg-[#bfa669]/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[#bfa669]">
                <span className="h-1 w-1 animate-pulse rounded-full bg-[#bfa669]" />
                Crowe Logic · AI Web Builder
              </div>

              <h1 className="text-[clamp(2.6rem,6.5vw,5rem)] font-semibold leading-[1.0] tracking-[-0.03em] text-[#e8e2cf]">
                Describe your business.
                <br />
                <span className="text-[#bfa669]">Get a website that's live.</span>
              </h1>

              <p className="mt-7 max-w-md text-lg leading-relaxed text-[#e8e2cf]/65">
                Tell us what you do in a sentence. We design a polished website,
                put it online, and connect your own domain — no code, no hosting,
                no headaches.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link href="/builder">
                  <Button
                    size="lg"
                    className="group h-13 rounded-full bg-[#bfa669] px-8 text-base font-semibold text-[#0b0b0c] shadow-[0_0_40px_-8px_rgba(191,166,105,0.5)] transition-all hover:bg-[#d4be84] hover:shadow-[0_0_50px_-6px_rgba(191,166,105,0.7)]"
                  >
                    Build my website
                    <ArrowRight className="ml-1 h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
                <span className="font-mono text-xs text-[#e8e2cf]/45">
                  free to start · no card
                </span>
              </div>
            </div>

            {/* product mock — app window chrome (canonical) */}
            <div className="relative">
              <div className="overflow-hidden rounded-xl border border-[#bfa669]/25 bg-[#06070b] shadow-[0_40px_140px_-40px_rgba(191,166,105,0.40)]">
                <div className="flex items-center gap-1.5 border-b border-[#bfa669]/15 bg-[#0a0b0f] px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#bfa669]/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#bfa669]/25" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#bfa669]/15" />
                  <span className="ml-3 font-mono text-[0.65rem] text-[#e8e2cf]/40">
                    bean-there.ai-webbuilder.com
                  </span>
                </div>
                {/* mini generated site (neutral — a customer's site, not Crowe-branded) */}
                <div className="bg-white text-[#1f1b16]">
                  <div className="bg-[#1f1b16] px-6 py-9 text-center text-white">
                    <p className="text-2xl font-semibold">Bean There</p>
                    <p className="mt-1 text-xs text-white/60">Neighborhood coffee, roasted daily</p>
                    <span className="mt-4 inline-block rounded-full bg-[#c2511f] px-4 py-1.5 text-xs font-semibold">
                      Reserve a table
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-4">
                    {["Espresso", "Pour Over", "Cold Brew"].map((x) => (
                      <div key={x} className="rounded-md bg-[#f0ece4] p-3">
                        <div className="mb-2 h-9 rounded bg-[#ddd4c4]" />
                        <p className="text-[0.6rem] font-semibold">{x}</p>
                        <p className="text-[0.55rem] text-[#7a756a]">$4.50</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* marquee */}
          <div className="relative z-10 border-y border-[#bfa669]/12 bg-black/30 py-3">
            <div className="flex items-center gap-8 overflow-hidden px-6 font-mono text-xs uppercase tracking-[0.25em] text-[#e8e2cf]/35">
              {["Restaurants", "Portfolios", "Local services", "Online stores", "Events", "Studios", "Cafés"].map((x) => (
                <span key={x} className="flex items-center gap-8 whitespace-nowrap">
                  {x} <span className="text-[#bfa669]/70">✦</span>
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section className="py-24">
          <div className="container mx-auto px-6">
            <div className="mb-14 max-w-2xl">
              <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-[#bfa669]">
                How it works
              </p>
              <h2 className="text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
                Three steps from a sentence to a site your customers can visit.
              </h2>
            </div>

            <div className="grid gap-px overflow-hidden rounded-2xl border border-[#bfa669]/15 bg-[#bfa669]/15 md:grid-cols-3">
              {[
                { n: "01", icon: Zap, title: "Describe it", body: "Tell us what your business does in one sentence — or pick a starter for your industry." },
                { n: "02", icon: Globe, title: "Make it yours", body: "A polished site appears in seconds. Refine the look and copy with a tap." },
                { n: "03", icon: ShieldCheck, title: "Go live", body: "Publish with one click. Hosting's included. Connect your own domain when you're ready." },
              ].map((f) => (
                <div key={f.n} className="group bg-[#0b0b0c] p-8 transition-colors hover:bg-[#15151a]">
                  <span className="font-mono text-sm text-[#bfa669]">{f.n}</span>
                  <f.icon className="mt-6 h-7 w-7 text-[#bfa669]" strokeWidth={1.5} />
                  <h3 className="mt-4 text-2xl font-semibold">{f.title}</h3>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-[#e8e2cf]/60">{f.body}</p>
                </div>
              ))}
            </div>

            {/* domain CTA band */}
            <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-2xl border border-[#bfa669]/25 bg-gradient-to-br from-[#15151a] to-[#0b0b0c] p-10 md:flex-row md:items-center">
              <div>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[#bfa669]">
                  Your name, your site
                </p>
                <h3 className="text-2xl font-semibold md:text-3xl">
                  Grab your own domain right here — we handle the technical setup.
                </h3>
              </div>
              <Link href="/builder">
                <Button
                  size="lg"
                  className="h-13 shrink-0 rounded-full bg-[#bfa669] px-7 font-semibold text-[#0b0b0c] hover:bg-[#d4be84]"
                >
                  Start building <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
