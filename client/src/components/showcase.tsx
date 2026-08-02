import { useState } from "react";

/**
 * Real output, in a browser frame.
 *
 * The page claimed the output "looks like a studio made it, not a template"
 * and then showed nothing, so a visitor had to take the one differentiating
 * claim on faith. These three images are actual documents put through the
 * actual renderer (script/showcase.ts + script/showcase-shots.py), so they
 * cannot drift from what the product ships: if the renderer regresses, the
 * marketing image regresses with it.
 *
 * One large frame with a switcher rather than three small cards, because three
 * 1280px captures shrunk into a 3-up grid are unreadable, and unreadable proof
 * is not proof.
 */
const SITES = [
  {
    id: "bakery",
    label: "Bakery",
    host: "ryeandember.com",
    note: "Terracotta warmth, menu and story sections.",
    src: "/showcase/bakery.webp",
  },
  {
    id: "trades",
    label: "Plumber",
    host: "halvorsenplumbing.com",
    note: "Industrial slate, service list and call-first layout.",
    src: "/showcase/trades.webp",
  },
  {
    id: "studio",
    label: "Yoga studio",
    host: "meridianyoga.com",
    note: "Coastal calm, class grid and gallery.",
    src: "/showcase/studio.webp",
  },
] as const;

export function Showcase() {
  const [active, setActive] = useState(0);
  const site = SITES[active];

  return (
    <section className="border-t border-gold/10 py-20">
      <div className="container mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold/90">
            Real output
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.8rem,4vw,2.7rem)] font-medium leading-[1.08] tracking-[-0.02em] text-parchment">
            Not a template with your name in it.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[1.02rem] leading-relaxed text-parchment/55">
            Every site is assembled from hand-designed sections and a curated
            palette, so the layout, the type and the rhythm change with the
            business. These three came out of the same builder you are about to
            use.
          </p>
        </div>

        {/* Switcher. Segmented, one accent, keyboard reachable. */}
        <div
          role="tablist"
          aria-label="Example sites"
          className="mt-10 flex flex-wrap items-center justify-center gap-2"
        >
          {SITES.map((s, i) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === active}
              aria-controls="showcase-frame"
              onClick={() => setActive(i)}
              className={`rounded-full px-4 py-1.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/55 ${
                i === active
                  ? "bg-gold/15 text-gold ring-1 ring-gold/35"
                  : "text-parchment/55 ring-1 ring-gold/10 hover:text-parchment/80 hover:ring-gold/25"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Browser frame. Chrome is drawn in CSS rather than baked into the
            capture, so re-shooting the images never re-shoots the chrome. */}
        <div id="showcase-frame" className="crowe-raised mt-8 overflow-hidden rounded-2xl">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-parchment/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-parchment/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-parchment/15" />
            <span className="ml-3 truncate font-mono text-[0.65rem] tracking-[0.08em] text-parchment/40">
              {site.host}
            </span>
          </div>
          {/* Fixed frame height with a top-anchored crop, so every example is
              the same size and the cut edge reads as a page that continues.
              No fade over the cut: these samples are light-on-cream and dark-on-
              charcoal by turns, so any single fade colour smears across one of
              them. A clean edge is honest at every palette. */}
          <img
            key={site.id}
            src={site.src}
            width={1600}
            height={1500}
            loading="lazy"
            decoding="async"
            alt={`A site built for ${site.label.toLowerCase()}: ${site.note}`}
            className="block h-[300px] w-full object-cover object-top sm:h-[440px] lg:h-[560px]"
          />
        </div>

        <p className="mt-4 text-center text-sm text-parchment/45">{site.note}</p>
      </div>
    </section>
  );
}
