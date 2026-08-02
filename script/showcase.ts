// Renders the showcase strip on the home page.
//
// The home page claims the output "looks like a studio made it, not a
// template" and then shows nothing, so a visitor has to take that on faith.
// These are real documents put through the real renderer, the same code path a
// customer's published site takes. Nothing here is a mockup, which is the whole
// point: if the renderer regresses, the marketing image regresses with it.
//
// Usage: npx tsx script/showcase.ts   (writes standalone HTML to /tmp/showcase)
// The PNGs are then captured by script/showcase-shots.py.

import { mkdirSync, writeFileSync } from "node:fs";
import { renderDocumentFull } from "../shared/renderer";
import { addGeneratedImages, imagesEnabled } from "../server/azure-image";
import type { SiteDocument } from "../shared/site-document";

const OUT = "/tmp/showcase";

const bakery: SiteDocument = {
  version: 1,
  meta: { name: "Rye & Ember", tagline: "Neighborhood bakery, Tucson" },
  theme: { preset: "terracotta-warmth", radius: "medium" },
  sections: [
    {
      type: "hero",
      layout: "split",
      headline: "Bread worth the walk.",
      subheadline:
        "Slow-fermented sourdough, laminated pastry, and coffee from a roaster four blocks away. Out of the oven by seven, gone by noon.",
      cta: { label: "See today's bake", action: "scroll-contact" },
      imageHint: "sourdough loaf on a wooden board",
    },
    {
      type: "menu",
      layout: "columns",
      title: "This week",
      items: [
        { name: "Country sourdough", description: "48-hour ferment, dark crust", price: "$9" },
        { name: "Olive and rosemary", description: "Castelvetrano, fresh herb", price: "$11" },
        { name: "Morning bun", description: "Orange zest, cardamom sugar", price: "$5" },
        { name: "Ham and gruyere croissant", description: "Cured in house", price: "$7" },
      ],
    },
    {
      type: "about",
      layout: "split",
      title: "Two ovens and a long timeline",
      body:
        "We started in a garage with a starter named Pearl and a deck oven that only heated on one side. The bread got better. The oven did not. Nine years later Pearl is still in the mix, and everything on the shelf begins the night before.",
      imageHint: "baker shaping dough on a floured bench",
    },
    {
      type: "contact",
      layout: "split",
      title: "Come by",
      email: "hello@ryeandember.com",
      phone: "555-0142",
      address: "412 N Fourth Ave, Tucson",
      hours: "Wed to Sun, 7am until sold out",
    },
  ] as any,
};

const trades: SiteDocument = {
  version: 1,
  meta: { name: "Halvorsen Plumbing", tagline: "Licensed, insured, on time" },
  theme: { preset: "industrial-slate", radius: "small" },
  sections: [
    {
      type: "hero",
      layout: "overlay",
      headline: "Water where it should be. Nowhere else.",
      subheadline:
        "Residential and light commercial plumbing across the east valley. Same-day emergency calls, flat quotes before the wrench comes out.",
      cta: { label: "Call 555-0118", action: "call", href: "555-0118" },
      imageHint: "copper pipe fittings on a workbench",
    },
    {
      type: "services",
      layout: "feature",
      title: "What we handle",
      items: [
        { name: "Emergency leaks", description: "Burst lines, failed valves, slab leaks. Two-hour window, seven days." },
        { name: "Water heaters", description: "Tank and tankless, swapped same day, hauled away and permitted." },
        { name: "Repipe and remodel", description: "Whole-house PEX and copper, coordinated with your contractor." },
        { name: "Drain and sewer", description: "Camera inspection, hydro jetting, and a recording you keep." },
      ],
    },
    {
      type: "testimonials",
      layout: "grid",
      title: "From the neighborhood",
      items: [
        { quote: "Called at six on a Sunday with water under the kitchen. Fixed and mopped by nine.", author: "D. Reyes", role: "Gilbert" },
        { quote: "Quoted flat, charged flat, and the new heater came with the permit already pulled.", author: "M. Okafor", role: "Mesa" },
      ],
    },
    {
      type: "cta",
      layout: "boxed",
      headline: "Standing water does not wait for business hours.",
      cta: { label: "Call 555-0118", action: "call", href: "555-0118" },
    },
  ] as any,
};

const studio: SiteDocument = {
  version: 1,
  meta: { name: "Meridian Yoga", tagline: "A small studio on the coast" },
  theme: { preset: "coastal-calm", radius: "large" },
  sections: [
    {
      type: "hero",
      layout: "centered",
      headline: "Twelve mats. One teacher. No mirrors.",
      subheadline:
        "Slow vinyasa and restorative classes in a room that seats twelve, so nobody practices in the back row.",
      cta: { label: "See the schedule", action: "scroll-contact" },
      imageHint: "morning light across a wooden studio floor",
    },
    {
      type: "services",
      layout: "grid",
      title: "Classes",
      items: [
        { name: "Slow flow", description: "Sixty minutes, breath-led, all levels welcome." },
        { name: "Restorative", description: "Bolsters and blankets provided. Nothing to hold, nothing to prove." },
        { name: "Beginners' four weeks", description: "One evening a week, same twelve people, start to finish." },
      ],
    },
    {
      type: "gallery",
      layout: "masonry",
      title: "The room",
      imageHints: ["studio window at sunrise", "folded blankets on a shelf", "bare wooden floor and a single plant"],
    },
    {
      type: "contact",
      layout: "stacked",
      title: "Find us",
      email: "hello@meridianyoga.com",
      address: "18 Harbour Lane",
      hours: "Classes Tuesday through Saturday",
    },
  ] as any,
};

const SITES = [
  { slug: "bakery", doc: bakery },
  { slug: "trades", doc: trades },
  { slug: "studio", doc: studio },
];

// Real photography, not gradients.
//
// The marketing page shows these three as proof of what the product makes, so
// they have to be made the way the product makes them: same renderer, same
// image generator. Rendering them with placeholder gradients meant the page
// advertising "not a template" was itself showing grey rectangles.
//
// Needs AZURE_CORE_API_KEY and AZURE_CORE_ENDPOINT in the environment. Without
// them this still writes the documents, with the gradients, and says so, rather
// than failing the build.
mkdirSync(OUT, { recursive: true });

if (!imagesEnabled()) {
  console.warn(
    "AZURE_CORE_ENDPOINT / AZURE_CORE_API_KEY not set: writing showcase with gradient placeholders.",
  );
}

// Roughly 50s an image and the deployment takes one call at a time, so these
// three kick off together but the images themselves queue. Expect minutes.
const built = await Promise.all(
  SITES.map(async ({ slug, doc }) => ({ slug, doc: await addGeneratedImages(doc, 4) })),
);

// Count every slot, not just section-level ones: products carry an image per
// item and galleries carry an index-aligned array, so counting `section.image`
// alone under-reports a gallery-heavy sample by three.
function imageCount(doc: SiteDocument): number {
  let n = 0;
  for (const section of doc.sections) {
    const s = section as any;
    if (s.image) n++;
    if (Array.isArray(s.items)) n += s.items.filter((i: any) => i?.image).length;
    if (Array.isArray(s.imageUrls)) n += s.imageUrls.filter(Boolean).length;
  }
  return n;
}

for (const { slug, doc } of built) {
  const html = renderDocumentFull(doc);
  writeFileSync(`${OUT}/${slug}.html`, html);
  console.log(
    `${OUT}/${slug}.html  ${imageCount(doc)} images, ${Math.round(html.length / 1024)}KB of HTML`,
  );
}
