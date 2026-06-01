import { Check } from "lucide-react";

// The guided end-to-end journey. A persistent, finite rail that always shows
// where the user is and nudges to the next step — never a terminal, never
// jargon. This is the core differentiator vs open-ended chat builders.
export type JourneyStep = "describe" | "refine" | "publish" | "done";

const STEPS: { id: JourneyStep; label: string; hint: string }[] = [
  { id: "describe", label: "Describe", hint: "Tell us about your business" },
  { id: "refine", label: "Refine", hint: "Tweak the look and copy" },
  { id: "publish", label: "Publish", hint: "Put it online" },
  { id: "done", label: "Live", hint: "Share your new site" },
];

const ORDER: JourneyStep[] = ["describe", "refine", "publish", "done"];

export function JourneyRail({ current }: { current: JourneyStep }) {
  const currentIdx = ORDER.indexOf(current);

  return (
    <div className="flex items-center gap-1 px-2">
      {STEPS.map((step, i) => {
        const idx = ORDER.indexOf(step.id);
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "current" : "todo";
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[0.7rem] font-semibold transition-colors ${
                  state === "done"
                    ? "bg-[#bfa669] text-white"
                    : state === "current"
                    ? "border-2 border-[#bfa669] text-[#bfa669]"
                    : "border border-[rgba(191,166,105,0.25)] text-[rgba(232,226,207,0.5)]"
                }`}
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={`hidden text-sm font-medium sm:inline ${
                  state === "current" ? "text-[#e8e2cf]" : "text-[rgba(232,226,207,0.5)]"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={`mx-2 h-px w-6 ${
                  idx < currentIdx ? "bg-[#bfa669]" : "bg-[rgba(191,166,105,0.18)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// The contextual nudge shown below the rail — plain language, one clear next action.
export function JourneyNudge({ current }: { current: JourneyStep }) {
  const messages: Record<JourneyStep, string> = {
    describe: "Describe your business below to get started — or tap a starter.",
    refine: "Looking good! Tweak it with a suggestion below, or hit Publish when you're happy.",
    publish: "Ready to go live? Hit Publish to put your site online.",
    done: "🎉 Your site is live. Copy the link and share it with the world.",
  };
  return (
    <p className="text-center text-sm text-[rgba(232,226,207,0.6)]">{messages[current]}</p>
  );
}
