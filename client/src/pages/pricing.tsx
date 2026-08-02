import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { BillingModal } from "@/components/settings/billing-modal";
import { useLocation } from "wouter";
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

// Pricing: Free vs Pro ($29.99/mo). CTAs route into the product — Free starts
// the builder, Pro opens checkout (or auth first when signed out). Crowe
// gold-on-graphite identity, matching the home hero.
const FREE = [
  "5 site generations per day",
  "Full workspace: describe, refine, publish",
  "One-click publish, hosting included",
  "Lead capture + owner content editing",
  "Publish to a crowe subdomain",
];
const PRO = [
  "Self-optimizing growth agent that A/B tests your copy and keeps the winners",
  "Unlimited site generations",
  "Generated photography on every section",
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
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(52rem 30rem at 50% -12%, rgba(59,130,246,0.12), transparent 62%)" }}
          />
          <div className="container relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-24 lg:pt-28">
            <div className="text-center">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-accent/90">
                Pricing
              </div>
              <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] font-medium leading-[1.05] tracking-[-0.02em] text-parchment">
                Start free. Upgrade when it's earning.
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-[1.05rem] leading-relaxed text-parchment/55">
                No card to start. Build and publish a real site today. Go Pro when
                you want a site that keeps improving itself, your own custom domain,
                richer media, and unlimited builds.
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-2">
              {/* Free */}
              <div className="flex flex-col rounded-2xl border border-accent/15 bg-graphite-soft/60 p-8">
                <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.18em] text-parchment/70">Free</h2>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight text-parchment">$0</span>
                  <span className="text-sm text-parchment/45">/ forever</span>
                </div>
                <p className="mt-2 text-sm text-parchment/55">Everything you need to launch a real site.</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {FREE.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-parchment/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent/70" strokeWidth={2} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  className="mt-8 h-11 w-full rounded-xl border-accent/30 text-parchment hover:bg-accent/10"
                  onClick={() => navigate("/builder")}
                >
                  Start building
                </Button>
              </div>

              {/* Pro */}
              <div className="relative flex flex-col rounded-2xl border border-accent/40 bg-graphite-soft p-8 shadow-[0_30px_90px_-40px_rgba(59,130,246,0.5)]">
                <div className="absolute right-6 top-6 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-accent">
                  Most popular
                </div>
                <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.18em] text-accent">Pro</h2>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight text-parchment">$29.99</span>
                  <span className="text-sm text-parchment/45">/ month</span>
                </div>
                <p className="mt-2 text-sm text-parchment/55">A living site that keeps improving itself, and looks its best.</p>
                <ul className="mt-6 flex-1 space-y-3">
                  {PRO.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-parchment/85">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-8 h-11 w-full rounded-xl bg-accent font-semibold text-graphite transition-all hover:shadow-[0_0_34px_-8px_rgba(59,130,246,0.75)]"
                  onClick={getPro}
                >
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  {user?.plan === "pro" ? "Manage subscription" : "Upgrade to Pro"}
                </Button>
              </div>
            </div>

            <p className="mt-10 text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-accent-dim">
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
