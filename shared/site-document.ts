import { z } from "zod";

// ============================================================================
// The Site Document — the typed contract between the AI and the renderer.
//
// The AI fills this structure; a trusted renderer turns it into HTML/CSS.
// The AI never writes executable code or markup, so it cannot produce a broken
// build or a security hole, and "refine" is a scoped patch to this document
// rather than a full regeneration. Design quality lives in the renderer, so
// output never looks like AI slop.
// ============================================================================

// ---- Theme: curated presets, not free-form colors ----
// Each preset is a hand-tuned palette + font pairing. The AI picks one (or a
// mood that maps to one); it cannot emit arbitrary CSS.
export const THEME_PRESETS = [
  "warm-editorial",   // cream paper, ink, ember accent — Fraunces serif
  "modern-minimal",   // white, near-black, single bold accent — clean sans
  "bold-dark",        // charcoal, off-white, vivid accent — high contrast
  "soft-organic",     // sage/sand, earthy, rounded — friendly
  "luxe-mono",        // black, gold, restrained — premium
  "fresh-vibrant",    // bright, energetic, playful — youthful
  "coastal-calm",     // pale blue/sand, navy ink, teal accent — wellness, hospitality
  "industrial-slate", // concrete grays, near-black, safety-orange — trades, auto, fabrication
  "botanical-fresh",  // off-white, deep forest green, blush — florists, garden, plants
  "tech-precision",   // true white, slate ink, electric indigo — SaaS, agencies
  "terracotta-warmth",// clay/cream, espresso ink, burnt sienna — bakeries, makers, ceramics
  "nocturne-luxe",    // deep plum/charcoal, champagne, rose-gold — salons, fine dining
] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const themeSchema = z.object({
  preset: z.enum(THEME_PRESETS),
  // Optional single accent override (hex) the renderer may honor within the
  // chosen preset. Kept narrow so the AI can't wreck contrast.
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  radius: z.enum(["none", "small", "medium", "large", "pill"]).default("medium"),
});
export type Theme = z.infer<typeof themeSchema>;

// ---- Section content types ----
// Every section is a discriminated union on `type`. Add a section type here +
// a template in the renderer; the AI gets the new capability automatically.

const ctaSchema = z.object({
  label: z.string(),
  // Where the button points. Renderer resolves to tel:/mailto:/anchor.
  action: z.enum(["scroll-contact", "call", "email", "external", "none"]).default("scroll-contact"),
  href: z.string().optional(),
});

// A real image, resolved server-side from an imageHint (e.g. via a stock photo
// API) AFTER generation. The AI never fills these — it only writes imageHints.
// Absent => the renderer draws a tasteful gradient placeholder (unchanged look).
export const resolvedImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().optional(),
  credit: z.string().optional(),     // photographer / source attribution
  creditUrl: z.string().url().optional(),
});
export type ResolvedImage = z.infer<typeof resolvedImageSchema>;

const heroSection = z.object({
  type: z.literal("hero"),
  // Layout variant the AI picks; default keeps the original centered hero so
  // documents created before variants existed render unchanged.
  layout: z.enum(["centered", "split", "overlay", "minimal"]).default("centered"),
  headline: z.string(),
  subheadline: z.string().optional(),
  cta: ctaSchema.optional(),
  // Image is described, not uploaded — renderer maps to a tasteful default or
  // a stock query. Keeps generation deterministic and safe.
  imageHint: z.string().optional(),
  image: resolvedImageSchema.optional(), // server-filled from imageHint
  videoUrl: z.string().optional(),       // Pro: generated hero background video (served via /api/video/:id)
});

const servicesSection = z.object({
  type: z.literal("services"),
  layout: z.enum(["grid", "list", "feature"]).default("grid"),
  title: z.string().default("What we do"),
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      icon: z.string().optional(), // lucide icon name hint
    }),
  ).min(1).max(8),
});

const menuSection = z.object({
  type: z.literal("menu"),
  layout: z.enum(["single", "columns", "grouped"]).default("single"),
  title: z.string().default("Menu"),
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      price: z.string().optional(),
    }),
  ).min(1).max(24),
});

const productsSection = z.object({
  type: z.literal("products"),
  layout: z.enum(["grid", "showcase", "list"]).default("grid"),
  title: z.string().default("Featured"),
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      price: z.string().optional(),
      imageHint: z.string().optional(),
      image: resolvedImageSchema.optional(), // server-filled from imageHint
    }),
  ).min(1).max(12),
});

const aboutSection = z.object({
  type: z.literal("about"),
  layout: z.enum(["centered", "split", "statement"]).default("centered"),
  title: z.string().default("About"),
  body: z.string(),
  imageHint: z.string().optional(),
  image: resolvedImageSchema.optional(), // server-filled from imageHint
});

const gallerySection = z.object({
  type: z.literal("gallery"),
  layout: z.enum(["grid-uniform", "masonry", "carousel-strip"]).default("grid-uniform"),
  title: z.string().default("Gallery"),
  // Image hints only — renderer fills with tasteful placeholders/stock.
  imageHints: z.array(z.string()).min(1).max(12),
  // Resolved server-side, parallel to imageHints (index-aligned). Absent entries
  // fall back to a gradient cell.
  imageUrls: z.array(resolvedImageSchema).optional(),
});

const testimonialsSection = z.object({
  type: z.literal("testimonials"),
  layout: z.enum(["cards", "single-spotlight", "marquee"]).default("cards"),
  title: z.string().default("What people say"),
  items: z.array(
    z.object({
      quote: z.string(),
      author: z.string(),
      role: z.string().optional(),
    }),
  ).min(1).max(6),
});

const contactSection = z.object({
  type: z.literal("contact"),
  layout: z.enum(["split", "stacked", "card"]).default("split"),
  title: z.string().default("Get in touch"),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  hours: z.string().optional(),
  // Renderer shows a simple, safe contact form that posts nowhere by default
  // (mailto), so there is no backend to misconfigure or leak.
  showForm: z.boolean().default(true),
});

const ctaSection = z.object({
  type: z.literal("cta"),
  layout: z.enum(["band", "boxed", "full-bleed"]).default("band"),
  headline: z.string(),
  cta: ctaSchema,
});

export const sectionSchema = z.discriminatedUnion("type", [
  heroSection,
  servicesSection,
  menuSection,
  productsSection,
  aboutSection,
  gallerySection,
  testimonialsSection,
  contactSection,
  ctaSection,
]);
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section["type"];

// ---- The document ----
export const siteDocumentSchema = z.object({
  version: z.literal(1).default(1),
  meta: z.object({
    name: z.string(),          // business name
    tagline: z.string().optional(),
    industry: z.string().optional(), // e.g. "restaurant", "plumber"
  }),
  theme: themeSchema,
  sections: z.array(sectionSchema).min(1).max(10),
});
export type SiteDocument = z.infer<typeof siteDocumentSchema>;

// ---- Outline (phase 1 of two-phase generation) ----
// A tiny, fast-to-generate skeleton: name + theme + the section sequence with
// each section's headline only. The renderer paints a themed skeleton from this
// in ~2s; phase 2 (fill) expands it into the full document with the same shape.
export const siteOutlineSchema = z.object({
  meta: z.object({
    name: z.string(),
    tagline: z.string().optional(),
    industry: z.string().optional(),
  }),
  theme: themeSchema,
  sections: z.array(
    z.object({
      type: z.string(), // one of SECTION_TYPES; renderer tolerates unknowns
      layout: z.string().optional(),
      headline: z.string(), // hero headline, or the section title
    }),
  ).min(1).max(10),
});
export type SiteOutline = z.infer<typeof siteOutlineSchema>;

// All section types, for the AI's instructions and the UI's add-section menu.
export const SECTION_TYPES: SectionType[] = [
  "hero",
  "services",
  "menu",
  "products",
  "about",
  "gallery",
  "testimonials",
  "contact",
  "cta",
];

export { sectionKey, findSectionIndex, patchSection } from "./section-key";
