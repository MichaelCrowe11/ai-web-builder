import { siteDocumentSchema, type SiteDocument } from "@shared/site-document";

// Parsed through the schema so the fixture can never drift from it.
export function fixtureDoc(): SiteDocument {
  return siteDocumentSchema.parse({
    version: 1,
    meta: { name: "Brava Bakery", tagline: "Bread worth crossing town for", industry: "bakery" },
    theme: { preset: "terracotta-warmth", radius: "medium" },
    sections: [
      {
        type: "hero", layout: "centered",
        headline: "Bread worth crossing town for.",
        subheadline: "Naturally leavened, baked before sunrise.",
        cta: { label: "Order ahead", action: "scroll-contact" },
        imageHint: "sourdough loaf on a wooden board",
      },
      {
        type: "about", layout: "centered", title: "Our story",
        body: "We bake before sunrise and sell out by noon.",
        imageHint: "baker dusting flour at dawn",
      },
      {
        type: "contact", layout: "stacked", title: "Visit us",
        email: "hello@brava.example", phone: "555-0100",
        address: "12 Main St, Phoenix", hours: "Tue-Sun 7-2", showForm: true,
      },
    ],
  });
}
