import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

const STAGES = [
  "Reading your brief",
  "Sketching the layout",
  "Writing your copy",
  "Choosing colors & type",
  "Putting it together",
];

// Lively, staged feedback during generation so a multi-second wait never feels
// hung. Stages advance on a timer (purely cosmetic); the real result swaps in
// when the request resolves.
export function GenerationOverlay({ refining, queued }: { refining: boolean; queued?: boolean }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (refining) return;
    setStage(0);
    const id = setInterval(() => setStage((s) => (s < STAGES.length - 1 ? s + 1 : s)), 2200);
    return () => clearInterval(id);
  }, [refining]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-graphite/80 backdrop-blur-sm">
      <div className="w-[min(22rem,90vw)] rounded-2xl border border-accent/20 bg-graphite-soft p-6 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 animate-pulse text-accent" />
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-accent/90">
            {queued ? "High demand" : refining ? "Applying your change" : "Building your site"}
          </span>
        </div>

        <p className="mt-3 text-lg font-semibold tracking-tight text-parchment">
          {queued ? "High demand right now. Your site is queued, hang tight…" : refining ? "Updating…" : `${STAGES[stage]}…`}
        </p>

        {/* indeterminate sweep */}
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-accent/10">
          <div className="h-full w-1/3 rounded-full bg-accent [animation:sweep_1.3s_ease-in-out_infinite]" />
        </div>

        {!refining && (
          <div className="mt-4 flex gap-1.5">
            {STAGES.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i <= stage ? "bg-accent/70" : "bg-accent/15"}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
