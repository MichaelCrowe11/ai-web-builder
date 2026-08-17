import { useEffect, useRef, useState } from "react";

/**
 * Real output, in a browser frame, shown being BUILT rather than just built.
 *
 * These three images are actual documents put through the actual renderer
 * (script/showcase.ts + script/showcase-shots.py), so they cannot drift from
 * what the product ships: if the renderer regresses, the marketing image
 * regresses with it.
 *
 * On each activation the frame replays a short build sequence (the real
 * pipeline's stages, ~1.8s) before the capture fades in, because the product's
 * claim is "a finished site in seconds" and a static crop cannot make that
 * claim. Autoplay cycles the examples while the frame is on screen and stops
 * the moment the visitor takes over; reduced motion gets instant swaps and no
 * autoplay.
 *
 * Exported as an embeddable unit (tabs, frame, caption) rather than a page
 * section, so the hero can put the product itself above the fold.
 */
const SITES = [
  {
    id: "bakery",
    label: "Bakery",
    host: "ryeandember.com",
    note: "Terracotta warmth. Generated photography, menu and story sections.",
    src: "/showcase/bakery.webp",
  },
  {
    id: "trades",
    label: "Plumber",
    host: "halvorsenplumbing.com",
    note: "Industrial slate. Generated hero, service list, call-first layout.",
    src: "/showcase/trades.webp",
  },
  {
    id: "studio",
    label: "Yoga studio",
    host: "meridianyoga.com",
    note: "Coastal calm. Generated hero, class grid and gallery.",
    src: "/showcase/studio.webp",
  },
] as const;

// The real pipeline's stages, in its own order.
const PHASES = [
  "Generating sections",
  "Setting type and palette",
  "Generating photography",
  "Publishing",
] as const;

const REPLAY_STEP_MS = 440; // per stage; whole sequence ~1.8s
const AUTOPLAY_MS = 7000;

export function BuildFrame({ className = "" }: { className?: string }) {
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<number>(PHASES.length); // length = done, image showing
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Only animate while the frame is actually on screen.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Build replay: step through the stages, then land on the capture.
  useEffect(() => {
    if (reducedRef.current || !inView) {
      setPhase(PHASES.length);
      return;
    }
    setPhase(0);
    const t = setInterval(() => {
      setPhase((p) => {
        if (p >= PHASES.length - 1) {
          clearInterval(t);
          return PHASES.length;
        }
        return p + 1;
      });
    }, REPLAY_STEP_MS);
    return () => clearInterval(t);
  }, [active, inView]);

  // Autoplay until the visitor takes over.
  useEffect(() => {
    if (!auto || paused || !inView || reducedRef.current) return;
    const t = setInterval(() => setActive((a) => (a + 1) % SITES.length), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [auto, paused, inView]);

  const site = SITES[active];
  const building = phase < PHASES.length;

  return (
    <div
      className={className}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Switcher sits on the rule directly above the frame it controls. */}
      <div className="flex items-end gap-6">
        <div aria-hidden className="mb-2 h-px flex-1 bg-line" />
        <div role="tablist" aria-label="Example sites" className="flex shrink-0 items-center gap-5">
          {SITES.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === active}
              aria-controls="showcase-frame"
              onClick={() => {
                setAuto(false); // the visitor took over
                setActive(i);
              }}
              className={`border-b pb-1.5 font-mono text-[0.68rem] uppercase tracking-[0.16em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55 ${
                i === active
                  ? "border-accent text-accent"
                  : "border-transparent text-parchment/40 hover:text-parchment/70"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Browser frame. Chrome is drawn in CSS rather than baked into the
          capture, so re-shooting the images never re-shoots the chrome. */}
      <div
        id="showcase-frame"
        ref={frameRef}
        aria-busy={building}
        className="crowe-raised mt-4 overflow-hidden rounded-xl shadow-[var(--crowe-z3),0_36px_100px_-36px_rgba(184,137,58,0.28)]"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-parchment/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-parchment/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-parchment/15" />
          <span className="ml-3 truncate font-mono text-[0.65rem] tracking-[0.08em] text-parchment/40">
            {site.host}
          </span>
          <span
            className={`ml-auto flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.16em] transition-opacity duration-200 ${
              building ? "text-accent opacity-100" : "text-parchment/35 opacity-100"
            }`}
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${building ? "bg-accent" : "bg-emerald-400/80"}`}
            />
            {building ? "building" : "live"}
          </span>
        </div>

        {/* Fixed frame height with a top-anchored crop, so every example is
            the same size and the cut edge reads as a page that continues.
            All captures stay mounted and crossfade, so a switch never flashes
            an empty frame. */}
        <div className="relative h-[320px] w-full sm:h-[420px] lg:h-[500px]">
          {SITES.map((s, i) => (
            <img
              key={s.id}
              src={s.src}
              width={1600}
              height={1500}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              alt={`A site built for ${s.label.toLowerCase()}: ${s.note}`}
              className={`absolute inset-0 block h-full w-full object-cover object-top transition-opacity duration-[280ms] ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none ${
                i === active && !building ? "opacity-100" : "opacity-0"
              }`}
            />
          ))}

          {/* Build ticker: the pipeline narrating itself while the capture
              is withheld. Decorative for assistive tech (aria-busy on the
              frame carries the state). */}
          <div
            aria-hidden
            className={`absolute inset-0 flex flex-col items-start justify-end gap-2 bg-graphite-soft p-6 transition-opacity duration-200 ease-[cubic-bezier(.16,1,.3,1)] sm:p-8 ${
              building ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {PHASES.map((label, i) => (
              <p
                key={label}
                className={`font-mono text-[0.68rem] uppercase tracking-[0.18em] transition-opacity duration-150 ${
                  i > phase
                    ? "opacity-0"
                    : i === phase
                      ? "text-accent"
                      : "text-parchment/35"
                }`}
              >
                {i < phase ? "· " : "▸ "}
                {label}
              </p>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-parchment/35">
        {site.note}
      </p>
    </div>
  );
}
