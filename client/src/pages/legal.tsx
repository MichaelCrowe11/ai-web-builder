import { Layout } from "@/components/layout";
import { Link } from "wouter";

// Legal pages: Privacy Policy + Terms of Service. Content is written against
// what the product actually does (shared/schema.ts + server/) — if data
// handling changes, these pages must change with it. Same Crowe
// gold-on-graphite identity as /pricing.

const CONTACT_EMAIL = "support@ai-webbuilder.com";
const EFFECTIVE_DATE = "June 6, 2026";

function LegalShell({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <Layout>
      <div className="bg-graphite text-parchment">
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(52rem 30rem at 50% -12%, rgba(59,130,246,0.10), transparent 62%)" }}
          />
          <div className="container relative z-10 mx-auto max-w-3xl px-6 pb-24 pt-24 lg:pt-28">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-accent/90">
              {kicker}
            </div>
            <h1 className="font-display text-[clamp(1.8rem,4vw,2.6rem)] font-medium leading-[1.08] tracking-[-0.02em] text-parchment">{title}</h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-parchment/45">Effective {EFFECTIVE_DATE}</p>
            <div className="mt-10 space-y-8">{children}</div>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.16em] text-accent">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.95rem] leading-relaxed text-parchment/70">{children}</div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell kicker="Legal" title="Privacy Policy">
      <S title="Who we are">
        <p>
          AI Web Builder (ai-webbuilder.com) is operated by Crowe Logic Inc. (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
          This policy describes what we collect, why, and what we do with it, both for people who build
          sites with us, and for people who visit sites our customers publish. Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">{CONTACT_EMAIL}</a>.
        </p>
      </S>

      <S title="What we collect from builders">
        <p>When you create an account and build sites, we store:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your username and, if you provide one, your email address.</li>
          <li>Your password, stored only as a salted hash (bcrypt), never in plain text.</li>
          <li>Your plan, generation usage counters, and a session cookie that keeps you signed in.</li>
          <li>The prompts you write, the sites you generate, and media (images, video) generated for them.</li>
        </ul>
      </S>

      <S title="Payments">
        <p>
          Subscriptions are processed by Stripe. Your card details go directly to Stripe, so we never see or
          store full card numbers. We keep only Stripe customer and subscription identifiers so we can manage
          your plan.
        </p>
      </S>

      <S title="AI processing">
        <p>
          Your prompts and site content are sent to Microsoft Azure OpenAI services to generate site
          structure, copy, images, and video. We do not use your prompts or content to train AI models,
          and under Azure&rsquo;s terms Microsoft does not train its models on this data either.
        </p>
      </S>

      <S title="Published sites and their visitors">
        <p>
          Sites published through AI Web Builder can include contact forms. Submissions to those forms
          (leads) are stored by us on behalf of the site owner, who controls that data. If you submitted a
          form on a published site, direct requests about your data to that site&rsquo;s owner.
        </p>
        <p>
          Published sites also record basic, first-party usage analytics for the site owner: a random
          visitor identifier, session identifier, which sections were viewed or clicked, and, where the
          owner runs content experiments, which variant was shown. We do not use advertising networks or
          cross-site tracking, and these identifiers are not linked to your identity.
        </p>
      </S>

      <S title="Cookies">
        <p>
          We use one essential cookie to keep builders signed in. There are no third-party advertising or
          tracking cookies.
        </p>
      </S>

      <S title="Where data lives, and who else touches it">
        <p>
          Data is hosted on Google Cloud in the United States. We share data only with the processors that
          run the service: Stripe (billing), Microsoft Azure (generation), and Google Cloud
          (hosting and database). We never sell it.
        </p>
      </S>

      <S title="Retention and deletion">
        <p>
          Your sites and leads are kept while your account is active. Deleting a project deletes its leads
          and analytics. To delete your account and its data entirely, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">{CONTACT_EMAIL}</a> and
          we will action it promptly.
        </p>
      </S>

      <S title="Changes">
        <p>
          If this policy changes materially, we will note the new effective date here. Continued use after a
          change means you accept the updated policy.
        </p>
      </S>

      <p className="border-t border-accent/15 pt-6 text-sm text-parchment/45">
        See also our <Link href="/terms" className="text-accent hover:underline">Terms of Service</Link>.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell kicker="Legal" title="Terms of Service">
      <S title="The agreement">
        <p>
          These terms govern your use of AI Web Builder (ai-webbuilder.com), a service of Crowe Logic Inc.
          By creating an account or using the service you agree to them.
        </p>
      </S>

      <S title="The service">
        <p>
          AI Web Builder generates, hosts, and publishes websites from your descriptions. The Free plan
          includes a limited number of generations per day and publishing to an ai-webbuilder.com subdomain.
          The Pro plan ($29.99/month) adds unlimited generations, richer media, and custom domains. Plan
          features may evolve; material reductions to a paid plan will be notified before they apply.
        </p>
      </S>

      <S title="Billing and cancellation">
        <p>
          Pro subscriptions are billed monthly through Stripe and renew automatically. You can cancel at any
          time; your plan stays active until the end of the period already paid, and no further charges are
          made. Charges already incurred are non-refundable except where the law requires otherwise.
        </p>
      </S>

      <S title="Your content">
        <p>
          You own the prompts you write and the sites you publish. You grant us the license needed to host,
          process, and serve that content, and that is all we use it for. To the extent generated output is
          capable of ownership, we assign our interest in it to you. You are responsible for the accuracy
          and legality of what your site says about your business.
        </p>
      </S>

      <S title="Acceptable use">
        <p>You may not use the service to publish or distribute:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Illegal content, or content that infringes others&rsquo; rights.</li>
          <li>Phishing, malware, or deceptive or fraudulent sites.</li>
          <li>Content designed to harass, defame, or exploit.</li>
        </ul>
        <p>We may unpublish sites or suspend accounts that violate these rules.</p>
      </S>

      <S title="Your visitors' data">
        <p>
          If your published site collects leads through forms, that data belongs to you and you are
          responsible for handling it lawfully, including any notice or consent your jurisdiction requires
          from your visitors. We store and surface it to you as described in our{" "}
          <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
        </p>
      </S>

      <S title="Availability and warranty">
        <p>
          The service is provided as-is. We work to keep it fast and available but do not guarantee
          uninterrupted operation, and we may change or discontinue features. AI-generated content can be
          wrong; review your site before relying on it.
        </p>
      </S>

      <S title="Liability">
        <p>
          To the maximum extent permitted by law, our total liability for any claim arising from the service
          is limited to the amount you paid us in the twelve months before the claim arose.
        </p>
      </S>

      <S title="Termination">
        <p>
          You may stop using the service at any time. We may suspend or terminate accounts that breach these
          terms. On termination, published sites are unpublished and data is handled per the Privacy Policy.
        </p>
      </S>

      <S title="Governing law">
        <p>These terms are governed by the laws of the State of Arizona, United States.</p>
      </S>

      <S title="Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">{CONTACT_EMAIL}</a>.
        </p>
      </S>

      <p className="border-t border-accent/15 pt-6 text-sm text-parchment/45">
        See also our <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
      </p>
    </LegalShell>
  );
}
