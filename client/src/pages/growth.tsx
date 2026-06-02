import { useEffect, useState } from "react";
import { useParams } from "wouter";

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

  if (err) return <div className="growth-error">Couldn't load growth: {err}</div>;
  if (!state) return <div>Loading...</div>;

  const rate = (s: { conversions: number; exposures: number }) =>
    s.exposures ? ((s.conversions / s.exposures) * 100).toFixed(1) : "0.0";

  return (
    <main className="growth">
      <h1>Mission Control</h1>

      <section>
        <h2>Goal</h2>
        {state.goal ? (
          <p>
            {state.goal.objective} -{">"}
            <strong>{state.goal.conversionEvent}</strong> · autonomy:{" "}
            {state.goal.constraints.autonomy}
          </p>
        ) : (
          <p>No goal set yet.</p>
        )}
      </section>

      <section>
        <h2>Active experiment</h2>
        {state.experiment ? (
          <div>
            <p>
              <em>{state.experiment.hypothesis}</em>
            </p>
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Exposures</th>
                  <th>Conversions</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {state.stats.map((s) => (
                  <tr key={s.variantId}>
                    <td>{s.variantId}</td>
                    <td>{s.exposures}</td>
                    <td>{s.conversions}</td>
                    <td>{rate(s)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.experiment.status === "proposed" && (
              <div className="controls">
                <button
                  onClick={() =>
                    act(`/experiments/${state.experiment.id}/approve`)
                  }
                >
                  Approve
                </button>
                <button
                  onClick={() =>
                    act(`/experiments/${state.experiment.id}/reject`)
                  }
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ) : (
          <p>
            No experiment running. The agent will propose one when there's
            enough traffic.
          </p>
        )}
      </section>

      <section>
        <h2>Decision feed</h2>
        <ul>
          {state.decisions.map((d, i) => (
            <li key={i}>
              {new Date(d.ts).toLocaleString()} -{" "}
              <strong>{d.kind}</strong>
              {d.detail?.reason ? ` · ${d.detail.reason}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
