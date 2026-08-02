import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";

interface GrowthState {
  goal: any | null;
  experiment: any | null;
  stats: Array<{ variantId: string; exposures: number; conversions: number }>;
  decisions: Array<{ ts: number; kind: string; detail: any }>;
}

export default function GrowthPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [state, setState] = useState<GrowthState | null>(null);
  const [err, setErr] = useState<string>("");

  async function load() {
    try {
      const r = await fetch(`/api/sites/${projectId}/growth`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState(await r.json());
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [projectId]);

  async function act(path: string, method = "POST") {
    await fetch(`/api/sites/${projectId}${path}`, { method });
    load();
  }

  const rate = (s: { conversions: number; exposures: number }) =>
    s.exposures ? ((s.conversions / s.exposures) * 100).toFixed(1) : "0.0";

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <main className="min-h-screen bg-graphite text-parchment font-sans px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs tracking-eyebrow uppercase text-accent-dim mb-1">Mission Control</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-parchment mb-8">
          Living Site
        </h1>
        {children}
      </div>
    </main>
  );

  if (err) return <Shell><p className="text-error">Couldn't load growth: {err}</p></Shell>;
  if (!state) return <Shell><p className="text-parchment-dim">Loading...</p></Shell>;

  const card = "rounded-sm border border-accent/15 bg-graphite-soft p-6 mb-6";
  const sectionLabel = "text-xs tracking-eyebrow uppercase text-accent-dim mb-3";

  return (
    <Shell>
      <section className={card}>
        <h2 className={sectionLabel}>Goal</h2>
        {state.goal ? (
          <p className="text-parchment">
            {state.goal.objective} {"->"} <strong className="text-accent">{state.goal.conversionEvent}</strong>
            <span className="text-parchment-dim"> · autonomy: {state.goal.constraints.autonomy}</span>
          </p>
        ) : (
          <p className="text-parchment-dim">No goal set yet.</p>
        )}
      </section>

      <section className={card}>
        <h2 className={sectionLabel}>Active experiment</h2>
        {state.experiment ? (
          <div>
            <p className="italic text-parchment-dim mb-4">{state.experiment.hypothesis}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-status uppercase text-parchment-dim">
                  <th className="border-b border-accent/15 py-2 font-medium">Variant</th>
                  <th className="border-b border-accent/15 py-2 font-medium">Exposures</th>
                  <th className="border-b border-accent/15 py-2 font-medium">Conversions</th>
                  <th className="border-b border-accent/15 py-2 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {state.stats.map((s) => (
                  <tr key={s.variantId}>
                    <td className="border-b border-accent/10 py-2 font-mono">{s.variantId}</td>
                    <td className="border-b border-accent/10 py-2">{s.exposures}</td>
                    <td className="border-b border-accent/10 py-2">{s.conversions}</td>
                    <td className="border-b border-accent/10 py-2 font-mono text-accent">{rate(s)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.experiment.status === "proposed" && (
              <div className="flex gap-3 mt-5">
                <Button size="sm" onClick={() => act(`/experiments/${state.experiment.id}/approve`)}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => act(`/experiments/${state.experiment.id}/reject`)}>
                  Reject
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-parchment-dim">
            No experiment running. The agent will propose one when there is enough traffic.
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className={sectionLabel}>Decision feed</h2>
        {state.decisions.length ? (
          <ul className="space-y-2 font-mono text-sm">
            {state.decisions.map((d, i) => (
              <li key={i} className="text-parchment-dim">
                <span className="text-accent-dim">{new Date(d.ts).toLocaleString()}</span>
                {" "}
                <strong className="text-accent">{d.kind}</strong>
                {d.detail?.reason ? ` · ${d.detail.reason}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-parchment-dim">No decisions yet.</p>
        )}
      </section>
    </Shell>
  );
}
