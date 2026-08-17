import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { BillingModal } from "@/components/settings/billing-modal";
import { useLocation } from "wouter";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

const FREE = [
  "5 site generations per day",
  "Generated hero photography",
  "Full describe, refine, and publish workspace",
  "One-click publish with hosting included",
  "Lead capture and owner content editing",
  "Web Builder subdomain",
];

const PRO = [
  "A/B testing that keeps the winning copy",
  "Unlimited site generations",
  "Generated photography across the page",
  "Generated hero video",
  "Your own custom domain",
  "Code view and GitHub export",
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
      <div className="bg-paper text-ink">
        <section className="relative overflow-hidden border-b border-paper-line">
          <div aria-hidden className="editorial-orbit absolute -right-48 -top-64 h-[44rem] w-[44rem] rounded-full" />
          <div className="container relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-20">
            <div className="grid gap-10 lg:grid-cols-[1fr_0.7fr] lg:items-end">
              <div>
                <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
                  Pricing
                </p>
                <h1 className="mt-6 max-w-[12ch] font-display text-[clamp(3.2rem,6.5vw,5.8rem)] font-medium leading-[0.95] tracking-[-0.038em] text-ink">
                  Start free. Upgrade when it earns its keep.
                </h1>
              </div>
              <p className="max-w-lg text-[1.05rem] leading-[1.7] text-warm-dim lg:pb-2">
                Build and publish a real site without a card. Go Pro for a site
                that keeps improving itself, richer media, your own domain, and
                unlimited builds.
              </p>
            </div>

            <div className="mt-16 grid gap-6 lg:grid-cols-2">
              <article className="flex flex-col border border-paper-line bg-paper-raised p-7 shadow-[0_12px_35px_rgba(26,23,20,0.07)] sm:p-9">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p className="font-mono text-[0.64rem] uppercase tracking-[0.22em] text-warm-dim">
                      Free
                    </p>
                    <div className="mt-5 flex items-baseline gap-3">
                      <span className="font-display text-6xl font-medium tracking-[-0.035em] text-ink">
                        $0
                      </span>
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-warm-dim">
                        forever
                      </span>
                    </div>
                  </div>
                  <span className="border border-paper-line px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-warm-dim">
                    No card
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-warm-dim">
                  Everything needed to launch a real site.
                </p>
                <ul className="mt-8 flex-1 space-y-3.5">
                  {FREE.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-sm leading-relaxed text-ink/75"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-dim" strokeWidth={2} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  className="mt-9 h-12 w-full rounded-md border-ink/20 bg-transparent font-semibold text-ink hover:bg-ink hover:text-paper"
                  onClick={() => navigate("/builder")}
                >
                  Start building
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </article>

              <article className="relative flex flex-col overflow-hidden bg-ink p-7 text-parchment shadow-[0_28px_80px_rgba(26,23,20,0.2)] sm:p-9">
                <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-accent-soft" />
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p className="font-mono text-[0.64rem] uppercase tracking-[0.22em] text-accent">
                      Pro
                    </p>
                    <div className="mt-5 flex items-baseline gap-3">
                      <span className="font-display text-6xl font-medium tracking-[-0.035em] text-parchment">
                        $29.99
                      </span>
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-parchment/40">
                        monthly
                      </span>
                    </div>
                  </div>
                  <span className="border border-accent/40 px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-accent">
                    Complete
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-parchment/55">
                  The complete site, media, domain, and growth system.
                </p>
                <ul className="mt-8 flex-1 space-y-3.5">
                  {PRO.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-3 text-sm leading-relaxed text-parchment/75"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-9 h-12 w-full rounded-md bg-accent font-semibold text-on-accent hover:bg-accent-soft"
                  onClick={getPro}
                >
                  {user?.plan === "pro" ? "Manage subscription" : "Upgrade to Pro"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </article>
            </div>

            <div className="mt-6 grid gap-6 border border-paper-line bg-paper-deep p-7 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-accent-dim">
                  For agents
                </p>
                <h2 className="mt-3 font-display text-2xl font-medium text-ink">
                  No subscription. Pay for the finished build.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-warm-dim">
                  One paid call returns one live site. Settle about $1 in USDC
                  over x402 on Base, only after the build succeeds.
                </p>
              </div>
              <a
                href="/llms.txt"
                className="inline-flex items-center gap-2 border-b border-accent pb-1 font-mono text-[0.64rem] uppercase tracking-[0.18em] text-accent-dim"
              >
                Read /llms.txt
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>

            <p className="mt-10 text-center font-mono text-[0.6rem] uppercase tracking-[0.2em] text-warm-dim">
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
