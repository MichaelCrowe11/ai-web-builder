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

export function Showcase() {
  const [active, setActive] = useState(0);
  const site = SITES[active];

  return (
    <section className="border-t border-line py-24">
      <div className="container mx-auto max-w-5xl px-6">
        {/* Header is left-aligned with the switcher opposite it, rather than a
            third centred stack. The page has one centred element and it is the
            prompt. */}
        <div className="max-w-xl">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.24em] text-accent-dim">
            Real output
          </p>
          <h2 className="mt-5 font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.06] tracking-[-0.02em] text-parchment">
            Not a template with your name in it.
          </h2>
          <p className="mt-5 text-[1rem] leading-relaxed text-parchment/55">
            Every site is assembled from hand-designed sections and a curated
            palette, so the layout, the type and the rhythm change with the
            business. The photography is generated for the site rather than
            pulled from a stock library, which is why no other page on the
            internet has these pictures. All three came out of the same builder
            you are about to use.
          </p>
        </div>

        {/* Switcher sits on the rule directly above the frame it controls,
            rather than floating beside the paragraph where it reads as a
            stranded object. A rule fills the space it does not need. */}
        <div className="mt-12 flex items-end gap-6">
          <div aria-hidden className="mb-2 h-px flex-1 bg-line" />
          <div role="tablist" aria-label="Example sites" className="flex shrink-0 items-center gap-6">
            {SITES.map((s, i) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={i === active}
                aria-controls="showcase-frame"
                onClick={() => setActive(i)}
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
        <div id="showcase-frame" className="crowe-raised mt-5 overflow-hidden rounded-xl">
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

        <p className="mt-4 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-parchment/35">
          {site.note}
        </p>
      </div>
    </section>
  );
}
