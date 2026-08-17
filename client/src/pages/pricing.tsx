import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { BillingModal } from "@/components/settings/billing-modal";
import { useLocation } from "wouter";
import { useState } from "react";
import { Check } from "lucide-react";

// Pricing: Free vs Pro ($29.99/mo). CTAs route into the product — Free starts
// the builder, Pro opens checkout (or auth first when signed out). Crowe
// gold-on-graphite identity, matching the home hero.
const FREE = [
  "5 site generations per day",
  "A hero photograph generated for your site, not stock",
  "Full workspace: describe, refine, publish",
  "One-click publish, hosting included",
  "Lead capture + owner content editing",
  "Publish to a crowe subdomain",
];
const PRO = [
  "Self-optimizing growth agent that A/B tests your copy and keeps the winners",
  "Unlimited site generations",
  "Generated photography across the page, not just the hero",
  "Generated hero video",
  "Connect your own custom domain",
  "Code view + GitHub export",
  "Priority generation queue",
];

export default function Pricing() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showAuth, setShowAuth] = useState(false);
  const [showBilling, setShowBilling] = useState(false);

  const getPro = () => (user ? setShowBilling(true) : setShowAuth(true));

  return (
    <Layout>
      <div className="bg-graphite text-parchment">
        <section className="relative overflow-hidden">
          <div aria-hidden className="ground-grid pointer-events-none absolute inset-0" />
          <div aria-hidden className="aurora hero-bloom-a pointer-events-none absolute inset-0" />
          <div
            aria-hidden
            className="aurora hero-bloom-b pointer-events-none absolute inset-0"
            style={{ animationDelay: "-9s" }}
          />
          <div className="container relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-20 lg:pt-24">
            <div className="max-w-2xl">
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
                Pricing
              </p>
              <h1 className="mt-5 font-display text-[clamp(2.2rem,4.8vw,3.6rem)] font-medium leading-[1.04] tracking-[-0.022em] text-parchment">
                Start free. Upgrade
                <br />
                when it's <em className="accent-sheen not-italic">earning</em>.
              </h1>
              <p className="mt-5 max-w-xl text-[1.05rem] leading-relaxed text-parchment/55">
                No card to start. Build and publish a real site today. Go Pro when
                you want a site that keeps improving itself, your own custom domain,
                richer media, and unlimited builds.
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-2">
              {/* Free */}
              <div className="crowe-panel flex flex-col rounded-2xl p-8">
                <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-parchment/70">Free</h2>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="font-display text-5xl font-medium tracking-[-0.02em] text-parchment">$0</span>
                  <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-parchment/40">forever</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-parchment/55">Everything you need to launch a real site.</p>
                <ul className="mt-7 flex-1 space-y-3">
                  {FREE.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm leading-relaxed text-parchment/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent/70" strokeWidth={2} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  className="mt-8 h-11 w-full rounded-xl border-accent/30 bg-graphite-raised/60 font-semibold text-parchment hover:bg-accent/10"
                  onClick={() => navigate("/builder")}
                >
                  Start building
                </Button>
              </div>

              {/* Pro: the jewel. */}
              <div className="gradient-border relative flex flex-col rounded-2xl bg-graphite-soft p-8 shadow-[var(--crowe-z3),0_36px_100px_-36px_rgba(59,130,246,0.35)]">
                <div className="absolute right-6 top-6 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-accent">
                  Most popular
                </div>
                <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-accent">Pro</h2>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="font-display text-5xl font-medium tracking-[-0.02em] text-parchment">$29.99</span>
                  <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-parchment/40">per month</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-parchment/55">A living site that keeps improving itself, and looks its best.</p>
                <ul className="mt-7 flex-1 space-y-3">
                  {PRO.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm leading-relaxed text-parchment/85">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="btn-jewel mt-8 h-11 w-full rounded-xl bg-accent font-semibold text-on-accent"
                  onClick={getPro}
                >
                  {user?.plan === "pro" ? "Manage subscription" : "Upgrade to Pro"}
                </Button>
              </div>
            </div>

            {/* The third customer is not a person. */}
            <div className="crowe-panel mt-5 flex flex-col gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div className="min-w-0">
                <h2 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-parchment/70">
                  For agents
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-parchment/55">
                  No plan at all. One paid API call, one finished site: about $1 in
                  USDC settled over x402 on Base, only after the build succeeds.
                </p>
              </div>
              <a
                href="/llms.txt"
                className="shrink-0 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-accent underline-offset-4 hover:underline"
              >
                Read /llms.txt →
              </a>
            </div>

            <p className="mt-10 text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-parchment/40">
              Cancel anytime · Secure checkout by Stripe
            </p>
          </div>
        </section>
      </div>

      <AuthModal open={showAuth} onOpenChange={setShowAuth} defaultMode="register" />
      <BillingModal open={showBilling} onOpenChange={setShowBilling} />
    </Layout>
  );
}
