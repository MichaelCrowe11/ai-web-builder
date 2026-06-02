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

const heroSection = z.object({
  type: z.literal("hero"),
  headline: z.string(),
  subheadline: z.string().optional(),
  cta: ctaSchema.optional(),
  // Image is described, not uploaded — renderer maps to a tasteful default or
  // a stock query. Keeps generation deterministic and safe.
  imageHint: z.string().optional(),
});

const servicesSection = z.object({
  type: z.literal("services"),
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
  title: z.string().default("Featured"),
  items: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      price: z.string().optional(),
      imageHint: z.string().optional(),
    }),
  ).min(1).max(12),
});

const aboutSection = z.object({
  type: z.literal("about"),
  title: z.string().default("About"),
  body: z.string(),
  imageHint: z.string().optional(),
});

const gallerySection = z.object({
  type: z.literal("gallery"),
  title: z.string().default("Gallery"),
  // Image hints only — renderer fills with tasteful placeholders/stock.
  imageHints: z.array(z.string()).min(1).max(12),
});

const testimonialsSection = z.object({
  type: z.literal("testimonials"),
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
