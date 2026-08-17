import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex min-h-[68vh] items-center bg-paper text-ink">
        <div className="container mx-auto max-w-6xl px-6 py-24">
          <p className="font-mono text-[0.64rem] uppercase tracking-[0.24em] text-accent-dim">
            404
          </p>
          <h1 className="mt-5 max-w-2xl font-display text-[clamp(3rem,6vw,5.4rem)] font-medium leading-[0.96] tracking-[-0.035em]">
            This page has not been built.
          </h1>
          <p className="mt-6 max-w-lg text-[1rem] leading-[1.7] text-warm-dim">
            The address may have changed, or the page may no longer exist.
          </p>
          <Link href="/">
            <span className="mt-8 inline-flex cursor-pointer items-center gap-2 border-b border-accent pb-1 font-mono text-[0.64rem] uppercase tracking-[0.18em] text-accent-dim">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to the homepage
            </span>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
