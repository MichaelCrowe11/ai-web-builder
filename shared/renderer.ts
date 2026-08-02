// ============================================================================
// The Renderer - turns a typed Site Document into a complete, beautiful website.
//
// This is where DESIGN QUALITY lives. The AI never writes markup; it fills a
// document (content + a layout variant + a theme), and these hand-crafted
// templates render it. Output can never be a broken build or a security hole,
// and variety comes from (a) 12 curated palettes, (b) multiple layout variants
// per section the AI chooses from, and (c) real imagery resolved server-side.
// ============================================================================
import type { SiteDocument, Section, Theme, ResolvedImage, SiteOutline } from "@shared/site-document";

// ---- Curated theme presets: palette + fonts + feel ----
interface ThemeTokens {
  bg: string;
  surface: string;
  ink: string;
  inkSoft: string;
  accent: string;
  accentInk: string; // text on accent
  border: string;
  displayFont: string;
  bodyFont: string;
  fontImport: string;
  headingWeight: string;
  headingStyle: string; // "normal" | "italic"
  uppercaseKicker: boolean;
}

const PRESETS: Record<string, ThemeTokens> = {
  "warm-editorial": {
    bg: "#f5efe2", surface: "#faf6ec", ink: "#1f1b16", inkSoft: "#6b6253",
    accent: "#c2511f", accentInk: "#faf6ec", border: "#e2d9c5",
    displayFont: "'Fraunces', Georgia, serif", bodyFont: "'Instrument Sans', system-ui, sans-serif",
    fontImport: "Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..500&family=Instrument+Sans:wght@400..600",
    headingWeight: "300", headingStyle: "normal", uppercaseKicker: true,
  },
  "modern-minimal": {
    bg: "#ffffff", surface: "#f7f7f8", ink: "#0a0a0a", inkSoft: "#6b6b70",
    accent: "#2563eb", accentInk: "#ffffff", border: "#e6e6e9",
    displayFont: "'Space Grotesk', system-ui, sans-serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Space+Grotesk:wght@400..700&family=Inter:wght@400..600",
    headingWeight: "600", headingStyle: "normal", uppercaseKicker: false,
  },
  "bold-dark": {
    bg: "#0f0f12", surface: "#1a1a20", ink: "#f2f2f0", inkSoft: "#a0a0a8",
    accent: "#e8ff4d", accentInk: "#0f0f12", border: "#2a2a32",
    displayFont: "'Clash Display', 'Space Grotesk', sans-serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Space+Grotesk:wght@500..700&family=Inter:wght@400..600",
    headingWeight: "700", headingStyle: "normal", uppercaseKicker: true,
  },
  "soft-organic": {
    bg: "#f3f1ea", surface: "#fbfaf6", ink: "#33352e", inkSoft: "#6f7165",
    accent: "#6b8e5a", accentInk: "#fbfaf6", border: "#dedacb",
    displayFont: "'Fraunces', Georgia, serif", bodyFont: "'Nunito Sans', system-ui, sans-serif",
    fontImport: "Fraunces:opsz,wght@9..144,400..600&family=Nunito+Sans:wght@400..600",
    headingWeight: "400", headingStyle: "normal", uppercaseKicker: false,
  },
  "luxe-mono": {
    bg: "#0c0c0c", surface: "#161616", ink: "#ece7da", inkSoft: "#9a9587",
    accent: "#c2a86a", accentInk: "#0c0c0c", border: "#2a2825",
    displayFont: "'Cormorant Garamond', Georgia, serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Cormorant+Garamond:ital,wght@0,400..600;1,400..500&family=Inter:wght@400..500",
    headingWeight: "500", headingStyle: "normal", uppercaseKicker: true,
  },
  "fresh-vibrant": {
    bg: "#fffdf7", surface: "#ffffff", ink: "#1a1a2e", inkSoft: "#5c5c72",
    accent: "#ff5470", accentInk: "#ffffff", border: "#ffe0e6",
    displayFont: "'Poppins', system-ui, sans-serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Poppins:wght@500..700&family=Inter:wght@400..600",
    headingWeight: "700", headingStyle: "normal", uppercaseKicker: false,
  },
  "coastal-calm": {
    bg: "#f4f8fa", surface: "#ffffff", ink: "#14304a", inkSoft: "#5a6b78",
    accent: "#2ba6a4", accentInk: "#ffffff", border: "#d8e6ec",
    displayFont: "'Albert Sans', system-ui, sans-serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Albert+Sans:wght@400..700&family=Inter:wght@400..600",
    headingWeight: "600", headingStyle: "normal", uppercaseKicker: false,
  },
  "industrial-slate": {
    bg: "#e9e9ea", surface: "#f6f6f7", ink: "#18181a", inkSoft: "#5c5c60",
    accent: "#ff5a1f", accentInk: "#ffffff", border: "#d2d2d4",
    displayFont: "'Archivo', system-ui, sans-serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Archivo:wght@500..800&family=Inter:wght@400..600",
    headingWeight: "700", headingStyle: "normal", uppercaseKicker: true,
  },
  "botanical-fresh": {
    bg: "#f7f6f1", surface: "#ffffff", ink: "#1f3326", inkSoft: "#5e6b60",
    accent: "#cf7e8e", accentInk: "#ffffff", border: "#e3e6dd",
    displayFont: "'Fraunces', Georgia, serif", bodyFont: "'Mulish', system-ui, sans-serif",
    fontImport: "Fraunces:opsz,wght@9..144,400..600&family=Mulish:wght@400..600",
    headingWeight: "400", headingStyle: "normal", uppercaseKicker: false,
  },
  "tech-precision": {
    bg: "#ffffff", surface: "#f6f7f9", ink: "#1e2230", inkSoft: "#646b7a",
    accent: "#4f46e5", accentInk: "#ffffff", border: "#e6e8ed",
    displayFont: "'Sora', system-ui, sans-serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Sora:wght@500..700&family=Inter:wght@400..600",
    headingWeight: "600", headingStyle: "normal", uppercaseKicker: false,
  },
  "terracotta-warmth": {
    bg: "#f6ede3", surface: "#fdf8f1", ink: "#3c2a20", inkSoft: "#7a685b",
    accent: "#b5532a", accentInk: "#fdf8f1", border: "#e7d6c4",
    displayFont: "'Newsreader', Georgia, serif", bodyFont: "'Nunito Sans', system-ui, sans-serif",
    fontImport: "Newsreader:opsz,wght@6..72,400..600&family=Nunito+Sans:wght@400..600",
    headingWeight: "500", headingStyle: "normal", uppercaseKicker: false,
  },
  "nocturne-luxe": {
    bg: "#15121c", surface: "#211c2b", ink: "#ece3d4", inkSoft: "#a89db0",
    accent: "#d9a679", accentInk: "#15121c", border: "#322a3e",
    displayFont: "'Playfair Display', Georgia, serif", bodyFont: "'Inter', system-ui, sans-serif",
    fontImport: "Playfair+Display:ital,wght@0,500..700;1,500..600&family=Inter:wght@400..500",
    headingWeight: "600", headingStyle: "normal", uppercaseKicker: true,
  },
};

const RADIUS: Record<string, string> = {
  none: "0px", small: "6px", medium: "12px", large: "20px", pill: "9999px",
};

function tokens(theme: Theme): ThemeTokens {
  const base = PRESETS[theme.preset] ?? PRESETS["warm-editorial"];
  // Honor a narrow accent override without wrecking contrast.
  return theme.accent ? { ...base, accent: theme.accent } : base;
}

function isDarkBg(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

// ---- Small HTML helpers ----
function esc(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
}

// Render a real image when one has been resolved, else the tasteful gradient
// placeholder (unchanged from before). The AI only supplies imageHints; the
// server resolves them to URLs after generation, so this stays deterministic.
function imageMarkup(image: ResolvedImage | undefined, imgClass: string, phClass: string): string {
  if (image?.url) {
    const credit = image.credit
      ? `<span class="photo-credit">${image.creditUrl ? `<a href="${esc(image.creditUrl)}" target="_blank" rel="noopener">${esc(image.credit)}</a>` : esc(image.credit)}</span>`
      : "";
    return `<img class="${imgClass}" src="${esc(image.url)}" alt="${esc(image.alt)}" loading="lazy" />${credit}`;
  }
  return `<div class="${phClass}"></div>`;
}

function ctaHref(action: string | undefined, href: string | undefined, doc: SiteDocument): string {
  switch (action) {
    case "call": {
      const phone = findPhone(doc);
      return phone ? `tel:${phone.replace(/[^0-9+]/g, "")}` : "#contact";
    }
    case "email": {
      const email = findEmail(doc);
      return email ? `mailto:${email}` : "#contact";
    }
    case "external": return esc(href) || "#";
    case "none": return "javascript:void(0)";
    default: return "#contact";
  }
}

function findPhone(doc: SiteDocument): string | undefined {
  const c = doc.sections.find((s) => s.type === "contact");
  return c && c.type === "contact" ? c.phone : undefined;
}
function findEmail(doc: SiteDocument): string | undefined {
  const c = doc.sections.find((s) => s.type === "contact");
  return c && c.type === "contact" ? c.email : undefined;
}

// ---- Per-section templates (each branches on the chosen layout variant) ----
// `open` carries data-section-key + the reveal stagger index.

function renderHero(section: Extract<Section, { type: "hero" }>, doc: SiteDocument, open: string): string {
  const layout = section.layout ?? "centered";
  const kicker = doc.meta.tagline ? `<p class="kicker">${esc(doc.meta.tagline)}</p>` : "";
  const lead = section.subheadline ? `<p class="lead">${esc(section.subheadline)}</p>` : "";
  const cta = section.cta
    ? `<a class="btn btn-primary" href="${ctaHref(section.cta.action, section.cta.href, doc)}" data-conversion="1">${esc(section.cta.label)}</a>`
    : "";
  const copy = `${kicker}<h1>${esc(section.headline)}</h1>${lead}${cta}`;

  // A generated background video (Pro) overrides the layout with a cinematic overlay hero.
  if (section.videoUrl) {
    return `
  <section class="hero hero--overlay hero--video" ${open}>
    <video class="hero-bg" src="${esc(section.videoUrl)}" autoplay muted loop playsinline preload="auto"></video>
    <div class="hero-scrim"></div>
    <div class="wrap hero-inner">${copy}</div>
  </section>`;
  }

  if (layout === "split") {
    return `
  <section class="hero hero--split" ${open}>
    <div class="wrap hero-split-grid">
      <div class="hero-copy">${copy}</div>
      <div class="hero-media-wrap">${imageMarkup(section.image, "hero-media", "hero-media hero-media--ph")}</div>
    </div>
  </section>`;
  }
  if (layout === "overlay") {
    const bg = section.image?.url
      ? `<img class="hero-bg" src="${esc(section.image.url)}" alt="${esc(section.image.alt)}" loading="eager" />`
      : `<div class="hero-bg hero-bg--ph"></div>`;
    return `
  <section class="hero hero--overlay" ${open}>
    ${bg}
    <div class="hero-scrim"></div>
    <div class="wrap hero-inner">${copy}</div>
  </section>`;
  }
  if (layout === "minimal") {
    return `
  <section class="hero hero--minimal" ${open}>
    <div class="wrap hero-inner">${copy}</div>
  </section>`;
  }
  // centered (default - original markup)
  return `
  <section class="hero hero--centered" ${open}>
    <div class="wrap hero-inner">${copy}</div>
  </section>`;
}

function renderServices(section: Extract<Section, { type: "services" }>, open: string): string {
  const layout = section.layout ?? "grid";
  const title = `<h2 class="sec-title">${esc(section.title)}</h2>`;

  if (layout === "list") {
    const rows = section.items.map((it, i) => `
        <div class="svc-row">
          <span class="svc-num">${String(i + 1).padStart(2, "0")}</span>
          <div class="svc-row-body"><h3>${esc(it.name)}</h3><p>${esc(it.description)}</p></div>
        </div>`).join("");
    return `
  <section class="band" ${open}>
    <div class="wrap wrap-narrow">${title}<div class="svc-list">${rows}</div></div>
  </section>`;
  }
  if (layout === "feature") {
    const rows = section.items.map((it, i) => `
        <div class="svc-feature ${i % 2 ? "svc-feature--alt" : ""}">
          <span class="svc-feature-index">${String(i + 1).padStart(2, "0")}</span>
          <div><h3>${esc(it.name)}</h3><p>${esc(it.description)}</p></div>
        </div>`).join("");
    return `
  <section class="band" ${open}>
    <div class="wrap">${title}<div class="svc-features">${rows}</div></div>
  </section>`;
  }
  // grid (default)
  return `
  <section class="band" ${open}>
    <div class="wrap">${title}
      <div class="grid grid-3">
        ${section.items.map((it) => `
        <div class="card"><h3>${esc(it.name)}</h3><p>${esc(it.description)}</p></div>`).join("")}
      </div>
    </div>
  </section>`;
}

function renderMenu(section: Extract<Section, { type: "menu" }>, open: string): string {
  const layout = section.layout ?? "single";
  const listClass = layout === "columns" ? "menu-list menu-list--cols" : layout === "grouped" ? "menu-list menu-list--grouped" : "menu-list";
  const rows = section.items.map((it) => `
        <div class="menu-row">
          <div class="menu-row-main">
            <span class="menu-name">${esc(it.name)}</span>
            ${it.price ? `<span class="menu-dots"></span><span class="menu-price">${esc(it.price)}</span>` : ""}
          </div>
          ${it.description ? `<p class="menu-desc">${esc(it.description)}</p>` : ""}
        </div>`).join("");
  return `
  <section class="band band-alt" ${open}>
    <div class="wrap ${layout === "columns" ? "" : "wrap-narrow"}">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="${listClass}">${rows}</div>
    </div>
  </section>`;
}

function renderProducts(section: Extract<Section, { type: "products" }>, open: string): string {
  const layout = section.layout ?? "grid";
  const title = `<h2 class="sec-title">${esc(section.title)}</h2>`;
  const card = (it: typeof section.items[number]) => `
        <div class="product">
          ${imageMarkup(it.image, "product-img", "product-img product-img--ph")}
          <div class="product-body">
            <h3>${esc(it.name)}</h3>
            ${it.description ? `<p>${esc(it.description)}</p>` : ""}
            ${it.price ? `<span class="product-price">${esc(it.price)}</span>` : ""}
          </div>
        </div>`;

  if (layout === "list") {
    const rows = section.items.map((it) => `
        <div class="product product--row">
          ${imageMarkup(it.image, "product-img", "product-img product-img--ph")}
          <div class="product-body">
            <h3>${esc(it.name)}</h3>
            ${it.description ? `<p>${esc(it.description)}</p>` : ""}
            ${it.price ? `<span class="product-price">${esc(it.price)}</span>` : ""}
          </div>
        </div>`).join("");
    return `
  <section class="band" ${open}><div class="wrap wrap-narrow">${title}<div class="product-rows">${rows}</div></div></section>`;
  }
  if (layout === "showcase" && section.items.length > 0) {
    const [first, ...rest] = section.items;
    return `
  <section class="band" ${open}><div class="wrap">${title}
    <div class="product product--hero">
      ${imageMarkup(first.image, "product-img", "product-img product-img--ph")}
      <div class="product-body"><h3>${esc(first.name)}</h3>${first.description ? `<p>${esc(first.description)}</p>` : ""}${first.price ? `<span class="product-price">${esc(first.price)}</span>` : ""}</div>
    </div>
    <div class="grid grid-3">${rest.map(card).join("")}</div>
  </div></section>`;
  }
  // grid (default)
  return `
  <section class="band" ${open}><div class="wrap">${title}<div class="grid grid-3">${section.items.map(card).join("")}</div></div></section>`;
}

function renderAbout(section: Extract<Section, { type: "about" }>, open: string): string {
  const layout = section.layout ?? "centered";
  if (layout === "split") {
    return `
  <section class="band band-alt" ${open}>
    <div class="wrap about-split">
      <div class="about-media-wrap">${imageMarkup(section.image, "about-media", "about-media about-media--ph")}</div>
      <div class="about-copy"><h2 class="sec-title">${esc(section.title)}</h2><p class="about-body">${esc(section.body)}</p></div>
    </div>
  </section>`;
  }
  if (layout === "statement") {
    return `
  <section class="band band-alt" ${open}>
    <div class="wrap wrap-narrow about about--statement"><p class="about-statement">${esc(section.body)}</p></div>
  </section>`;
  }
  // centered (default)
  return `
  <section class="band band-alt" ${open}>
    <div class="wrap wrap-narrow about"><h2 class="sec-title">${esc(section.title)}</h2><p class="about-body">${esc(section.body)}</p></div>
  </section>`;
}

function renderGallery(section: Extract<Section, { type: "gallery" }>, open: string): string {
  const layout = section.layout ?? "grid-uniform";
  const galClass = layout === "masonry" ? "gallery gallery--masonry" : layout === "carousel-strip" ? "gallery gallery--strip" : "gallery";
  const cells = section.imageHints.map((_, i) =>
    imageMarkup(section.imageUrls?.[i], "gallery-img", "gallery-cell"),
  ).join("");
  return `
  <section class="band" ${open}>
    <div class="wrap"><h2 class="sec-title">${esc(section.title)}</h2><div class="${galClass}">${cells}</div></div>
  </section>`;
}

function renderTestimonials(section: Extract<Section, { type: "testimonials" }>, open: string): string {
  const layout = section.layout ?? "cards";
  const title = `<h2 class="sec-title">${esc(section.title)}</h2>`;
  const fig = (it: typeof section.items[number]) => `
        <figure class="quote">
          <blockquote>${esc(it.quote)}</blockquote>
          <figcaption>${esc(it.author)}${it.role ? `<span>${esc(it.role)}</span>` : ""}</figcaption>
        </figure>`;
  if (layout === "single-spotlight") {
    return `
  <section class="band band-alt" ${open}><div class="wrap wrap-narrow">${title}<div class="quote-spotlight">${section.items.map(fig).join("")}</div></div></section>`;
  }
  if (layout === "marquee") {
    return `
  <section class="band band-alt" ${open}><div class="wrap">${title}<div class="quote-marquee">${section.items.map(fig).join("")}</div></div></section>`;
  }
  // cards (default)
  return `
  <section class="band band-alt" ${open}><div class="wrap">${title}<div class="grid grid-3">${section.items.map(fig).join("")}</div></div></section>`;
}

function renderContact(section: Extract<Section, { type: "contact" }>, open: string): string {
  const layout = section.layout ?? "split";
  const info = `
        <div class="contact-info">
          ${section.phone ? `<p><strong>Call</strong><a href="tel:${esc(section.phone).replace(/[^0-9+]/g, "")}">${esc(section.phone)}</a></p>` : ""}
          ${section.email ? `<p><strong>Email</strong><a href="mailto:${esc(section.email)}">${esc(section.email)}</a></p>` : ""}
          ${section.address ? `<p><strong>Visit</strong>${esc(section.address)}</p>` : ""}
          ${section.hours ? `<p><strong>Hours</strong>${esc(section.hours)}</p>` : ""}
        </div>`;
  const form = section.showForm ? `
        <form class="contact-form" action="${section.email ? `mailto:${esc(section.email)}` : "#"}" method="post" enctype="text/plain">
          <input type="text" name="name" placeholder="Your name" required />
          <input type="email" name="email" placeholder="Your email" required />
          <textarea name="message" placeholder="How can we help?" rows="4"></textarea>
          <button type="submit" class="btn btn-primary">Send message</button>
        </form>` : "";
  const gridClass = layout === "stacked" ? "contact-grid contact-grid--stacked" : layout === "card" ? "contact-grid contact-grid--card" : "contact-grid";
  return `
  <section class="band" id="contact" ${open}>
    <div class="wrap wrap-narrow contact">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="${gridClass}">${info}${form}</div>
    </div>
  </section>`;
}

function renderCtaBand(section: Extract<Section, { type: "cta" }>, doc: SiteDocument, open: string): string {
  const layout = section.layout ?? "band";
  const inner = `
      <h2>${esc(section.headline)}</h2>
      <a class="btn btn-invert" href="${ctaHref(section.cta.action, section.cta.href, doc)}" data-conversion="1">${esc(section.cta.label)}</a>`;
  if (layout === "boxed") {
    return `
  <section class="band" ${open}><div class="wrap"><div class="cta-box">${inner}</div></div></section>`;
  }
  if (layout === "full-bleed") {
    return `
  <section class="cta-band cta-band--full" ${open}><div class="wrap cta-inner cta-inner--center">${inner}</div></section>`;
  }
  // band (default)
  return `
  <section class="cta-band" ${open}><div class="wrap cta-inner">${inner}</div></section>`;
}

// index is the section's position in doc.sections - injected as data-section-key
// + a --i stagger index for the scroll-reveal animation.
function renderSection(section: Section, doc: SiteDocument, index: number): string {
  const open = `data-section-key="${index}:${section.type}" style="--i:${index}"`;
  switch (section.type) {
    case "hero": return renderHero(section, doc, open);
    case "services": return renderServices(section, open);
    case "menu": return renderMenu(section, open);
    case "products": return renderProducts(section, open);
    case "about": return renderAbout(section, open);
    case "gallery": return renderGallery(section, open);
    case "testimonials": return renderTestimonials(section, open);
    case "contact": return renderContact(section, open);
    case "cta": return renderCtaBand(section, doc, open);
    default: return "";
  }
}

// ---- The stylesheet (driven by theme tokens) ----
function renderCss(theme: Theme): string {
  const t = tokens(theme);
  const r = RADIUS[theme.radius] ?? RADIUS.medium;
  const dark = isDarkBg(t.bg);
  // Soft elevation on light themes; near-flat on dark (shadows read poorly on dark).
  const shadowSm = dark ? "0 1px 0 var(--border)" : "0 1px 2px rgba(15,15,20,.05), 0 1px 1px rgba(15,15,20,.04)";
  const shadowMd = dark ? "0 0 0 1px var(--border)" : "0 6px 18px rgba(15,15,20,.07), 0 2px 6px rgba(15,15,20,.05)";
  const shadowLg = dark ? "0 0 0 1px var(--border)" : "0 18px 40px rgba(15,15,20,.10), 0 6px 14px rgba(15,15,20,.06)";
  return `
:root {
  --bg:${t.bg}; --surface:${t.surface}; --ink:${t.ink}; --ink-soft:${t.inkSoft};
  --accent:${t.accent}; --accent-ink:${t.accentInk}; --border:${t.border}; --r:${r};
  --shadow-sm:${shadowSm}; --shadow-md:${shadowMd}; --shadow-lg:${shadowLg};
  --step-0:1rem;
  --step-1:clamp(1.1rem,.5vw + 1rem,1.3rem);
  --step-2:clamp(1.35rem,1vw + 1.1rem,1.75rem);
  --step-3:clamp(1.7rem,2.2vw + 1rem,2.6rem);
  --step-4:clamp(2.3rem,4vw + 1rem,3.6rem);
  --step-5:clamp(2.8rem,7vw,5.2rem);
}
* { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:var(--bg); color:var(--ink); font-family:${t.bodyFont}; line-height:1.6; -webkit-font-smoothing:antialiased; }
img { max-width:100%; display:block; }
.wrap { max-width:1140px; margin:0 auto; padding:0 24px; }
.wrap-narrow { max-width:760px; }
h1,h2,h3 { font-family:${t.displayFont}; font-weight:${t.headingWeight}; font-style:${t.headingStyle}; letter-spacing:-0.01em; line-height:1.08; }
.kicker { font-family:${t.bodyFont}; font-size:.72rem; letter-spacing:.22em; ${t.uppercaseKicker ? "text-transform:uppercase;" : ""} color:var(--accent); margin-bottom:1.25rem; font-weight:600; }
.btn { display:inline-block; padding:.95rem 2rem; border-radius:var(--r); font-weight:600; text-decoration:none; transition:transform .15s ease, box-shadow .2s ease, opacity .15s ease; cursor:pointer; border:none; font-size:1rem; font-family:inherit; }
.btn:hover { transform:translateY(-2px); box-shadow:var(--shadow-md); }
.btn-primary { background:var(--accent); color:var(--accent-ink); }
.btn-invert { background:var(--bg); color:var(--ink); }
.photo-credit { display:block; font-size:.68rem; color:var(--ink-soft); opacity:.7; margin-top:.35rem; }
.photo-credit a { color:inherit; }

/* hero */
.hero { padding:8rem 0 6rem; position:relative; }
.hero-inner { max-width:780px; }
.hero h1 { font-size:var(--step-5); }
.hero .lead { font-size:var(--step-2); color:var(--ink-soft); margin:1.5rem 0 2.5rem; max-width:34rem; }
.hero--minimal { padding:9rem 0 7rem; }
.hero--minimal h1 { max-width:16ch; }
.hero-split-grid { display:grid; grid-template-columns:1.05fr .95fr; gap:3.5rem; align-items:center; }
.hero--split { padding:6rem 0; }
.hero-media, .hero-media--ph { width:100%; aspect-ratio:4/5; object-fit:cover; border-radius:var(--r); box-shadow:var(--shadow-lg); }
.hero-media--ph { background:linear-gradient(135deg,var(--accent),var(--border)); }
.hero--overlay { padding:0; min-height:72vh; display:flex; align-items:center; overflow:hidden; }
.hero--overlay .hero-bg, .hero--overlay .hero-bg--ph { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0; }
.hero-bg--ph { background:linear-gradient(135deg,var(--accent),var(--ink)); }
.hero--overlay .hero-scrim { position:absolute; inset:0; background:linear-gradient(90deg,rgba(0,0,0,.62),rgba(0,0,0,.18)); z-index:1; }
.hero--overlay .hero-inner { position:relative; z-index:2; color:#fff; padding:5rem 0; }
.hero--overlay h1, .hero--overlay .lead { color:#fff; }
.hero--overlay .kicker { color:#fff; opacity:.85; }

/* bands */
.band { padding:5rem 0; }
.band-alt { background:var(--surface); }
.sec-title { font-size:var(--step-3); margin-bottom:2.5rem; }

/* grids */
.grid { display:grid; gap:1.5rem; }
.grid-3 { grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:2rem; box-shadow:var(--shadow-sm); transition:transform .2s ease, box-shadow .2s ease; }
.card:hover { transform:translateY(-3px); box-shadow:var(--shadow-md); }
.band-alt .card { background:var(--bg); }
.card h3 { font-size:var(--step-1); margin-bottom:.6rem; }
.card p { color:var(--ink-soft); }

/* services - list + feature variants */
.svc-list { display:flex; flex-direction:column; }
.svc-row { display:flex; gap:1.5rem; padding:1.6rem 0; border-top:1px solid var(--border); }
.svc-row:last-child { border-bottom:1px solid var(--border); }
.svc-num { font-family:${t.displayFont}; font-size:1.4rem; color:var(--accent); min-width:2.5rem; }
.svc-row-body h3 { font-size:var(--step-1); margin-bottom:.3rem; }
.svc-row-body p { color:var(--ink-soft); }
.svc-features { display:flex; flex-direction:column; gap:2.5rem; }
.svc-feature { display:grid; grid-template-columns:auto 1fr; gap:1.5rem; align-items:start; padding-left:1.5rem; border-left:3px solid var(--accent); }
.svc-feature--alt { border-left-color:var(--border); }
.svc-feature-index { font-family:${t.displayFont}; font-size:2rem; color:var(--accent); line-height:1; }
.svc-feature h3 { font-size:var(--step-2); margin-bottom:.4rem; }
.svc-feature p { color:var(--ink-soft); max-width:46ch; }

/* menu */
.menu-list { display:flex; flex-direction:column; gap:1.25rem; }
.menu-list--cols { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem 3rem; }
.menu-list--grouped .menu-row { padding-bottom:1.25rem; border-bottom:1px solid var(--border); }
.menu-row-main { display:flex; align-items:baseline; gap:.5rem; }
.menu-name { font-weight:600; font-size:1.15rem; }
.menu-dots { flex:1; border-bottom:1px dotted var(--border); transform:translateY(-3px); }
.menu-price { color:var(--accent); font-weight:600; }
.menu-desc { color:var(--ink-soft); font-size:.95rem; margin-top:.2rem; }

/* products */
.product { border:1px solid var(--border); border-radius:var(--r); overflow:hidden; background:var(--surface); box-shadow:var(--shadow-sm); transition:transform .2s ease, box-shadow .2s ease; }
.product:hover { transform:translateY(-3px); box-shadow:var(--shadow-md); }
.product-img { aspect-ratio:4/3; width:100%; object-fit:cover; }
.product-img--ph { background:linear-gradient(135deg,var(--border),var(--surface)); }
.product-body { padding:1.4rem; }
.product-body h3 { font-size:1.25rem; margin-bottom:.4rem; }
.product-body p { color:var(--ink-soft); font-size:.95rem; margin-bottom:.6rem; }
.product-price { color:var(--accent); font-weight:700; font-size:1.1rem; }
.product-rows { display:flex; flex-direction:column; gap:1.25rem; }
.product--row { display:grid; grid-template-columns:200px 1fr; align-items:center; }
.product--row .product-img { aspect-ratio:1; height:100%; }
.product--hero { display:grid; grid-template-columns:1.2fr 1fr; align-items:center; margin-bottom:2rem; box-shadow:var(--shadow-lg); }
.product--hero .product-img { aspect-ratio:16/10; height:100%; }
.product--hero .product-body { padding:2.5rem; }
.product--hero h3 { font-size:var(--step-3); }

/* about */
.about { text-align:center; }
.about-body { font-size:1.25rem; color:var(--ink-soft); line-height:1.8; }
.about-split { display:grid; grid-template-columns:.9fr 1.1fr; gap:3rem; align-items:center; }
.about-split .about-body { font-size:1.1rem; }
.about-media, .about-media--ph { width:100%; aspect-ratio:4/5; object-fit:cover; border-radius:var(--r); box-shadow:var(--shadow-lg); }
.about-media--ph { background:linear-gradient(135deg,var(--accent),var(--border)); }
.about--statement { text-align:center; padding:2rem 0; }
.about-statement { font-family:${t.displayFont}; font-weight:${t.headingWeight}; font-size:var(--step-4); line-height:1.2; letter-spacing:-.01em; }

/* gallery */
.gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; }
.gallery-cell, .gallery-img { aspect-ratio:1; width:100%; object-fit:cover; border-radius:var(--r); }
.gallery-cell { background:linear-gradient(135deg,var(--border),var(--surface)); }
.gallery--masonry { display:block; column-count:3; column-gap:1rem; }
.gallery--masonry .gallery-img, .gallery--masonry .gallery-cell { margin-bottom:1rem; aspect-ratio:auto; height:auto; min-height:160px; break-inside:avoid; }
.gallery--strip { display:flex; gap:1rem; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:.5rem; }
.gallery--strip .gallery-img, .gallery--strip .gallery-cell { flex:0 0 280px; scroll-snap-align:start; }

/* testimonials */
.quote { background:var(--bg); border:1px solid var(--border); border-radius:var(--r); padding:2rem; box-shadow:var(--shadow-sm); }
.band-alt .quote { background:var(--surface); }
.quote blockquote { font-size:1.15rem; font-style:italic; margin-bottom:1.2rem; }
.quote figcaption { font-weight:600; }
.quote figcaption span { display:block; color:var(--ink-soft); font-weight:400; font-size:.9rem; }
.quote-spotlight { display:flex; flex-direction:column; gap:1.5rem; }
.quote-spotlight .quote { text-align:center; padding:2.5rem; }
.quote-spotlight blockquote { font-size:var(--step-2); }
.quote-marquee { display:flex; gap:1.5rem; overflow-x:auto; scroll-snap-type:x mandatory; padding-bottom:.5rem; }
.quote-marquee .quote { flex:0 0 340px; scroll-snap-align:start; }

/* contact */
.contact-grid { display:grid; grid-template-columns:1fr 1fr; gap:3rem; }
.contact-grid--stacked { grid-template-columns:1fr; max-width:520px; margin:0 auto; }
.contact-grid--card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:2.5rem; box-shadow:var(--shadow-md); }
.contact-info p { margin-bottom:1.25rem; }
.contact-info strong { display:block; font-size:.75rem; text-transform:uppercase; letter-spacing:.12em; color:var(--accent); margin-bottom:.2rem; }
.contact-info a { color:var(--ink); text-decoration:none; font-size:1.1rem; }
.contact-form { display:flex; flex-direction:column; gap:.8rem; }
.contact-form input, .contact-form textarea { padding:.9rem 1rem; border:1px solid var(--border); border-radius:var(--r); background:var(--surface); font-family:inherit; font-size:1rem; color:var(--ink); }
.contact-form textarea { resize:vertical; }

/* cta band */
.cta-band { background:var(--accent); color:var(--accent-ink); padding:5rem 0; }
.cta-band--full { padding:7rem 0; }
.cta-inner { display:flex; align-items:center; justify-content:space-between; gap:2rem; flex-wrap:wrap; }
.cta-inner--center { flex-direction:column; text-align:center; }
.cta-band h2 { font-size:var(--step-3); max-width:30rem; }
.cta-band--full h2 { max-width:24ch; }
.cta-box { background:var(--accent); color:var(--accent-ink); border-radius:var(--r); padding:3rem; display:flex; align-items:center; justify-content:space-between; gap:2rem; flex-wrap:wrap; box-shadow:var(--shadow-lg); }
.cta-box h2 { font-size:var(--step-3); max-width:28rem; }

footer.site-footer { padding:3rem 0; border-top:1px solid var(--border); text-align:center; color:var(--ink-soft); font-size:.9rem; }

/* scroll reveal (respects reduced-motion) */
@media (prefers-reduced-motion: no-preference) {
  [data-section-key] { opacity:0; transform:translateY(18px); animation:reveal .6s cubic-bezier(.2,.7,.3,1) forwards; animation-delay:calc(var(--i,0) * .06s); }
  @keyframes reveal { to { opacity:1; transform:none; } }
}

@media (max-width:1024px) {
  .hero-split-grid, .about-split, .product--hero { grid-template-columns:1fr; }
  .product--hero .product-img { aspect-ratio:16/9; }
  .gallery--masonry { column-count:2; }
}
@media (max-width:768px) {
  .contact-grid:not(.contact-grid--stacked) { grid-template-columns:1fr; }
  .menu-list--cols { grid-template-columns:1fr; }
  .product--row { grid-template-columns:120px 1fr; }
  .cta-inner, .cta-box { flex-direction:column; align-items:flex-start; }
}
@media (max-width:520px) {
  .hero { padding:5rem 0 4rem; }
  .gallery--masonry { column-count:1; }
  .product--row { grid-template-columns:1fr; }
  .product--row .product-img { aspect-ratio:16/9; }
}
`;
}

// ---- Public API ----

/** The CSS for a document's theme (used by the live preview iframe). */
export function renderDocumentCss(doc: SiteDocument): string {
  return renderCss(doc.theme);
}

/** The body HTML for a document (sections + footer), no <html> wrapper. */
export function renderDocumentBody(doc: SiteDocument): string {
  const sections = doc.sections.map((s, i) => renderSection(s, doc, i)).join("\n");
  return `${sections}
  <footer class="site-footer">
    <div class="wrap">© ${esc(doc.meta.name)}</div>
  </footer>`;
}

// ---- Phase 1 skeleton (instant paint from the fast outline) ----
const SKELETON_CSS = `
.sk { background:linear-gradient(90deg,var(--surface) 0%,var(--border) 45%,var(--surface) 80%); background-size:200% 100%; animation:sksh 1.4s ease-in-out infinite; border-radius:var(--r); }
@keyframes sksh { 0% { background-position:180% 0; } 100% { background-position:-20% 0; } }
.sk-line { height:1.05rem; margin-top:1rem; }
.hero .sk-line { max-width:34rem; }
.band .sk-line { margin-left:auto; margin-right:auto; max-width:40rem; }
.sk-btn { height:3rem; width:12rem; margin-top:2rem; }
.sk-card { height:12rem; }
.skeleton .sec-title, .skeleton h1 { opacity:.92; }
`;

function renderOutlineSection(s: SiteOutline["sections"][number], outline: SiteOutline, index: number): string {
  const open = `data-section-key="${index}:${s.type}" style="--i:${index}"`;
  const head = esc(s.headline);
  if (s.type === "hero") {
    return `
  <section class="hero hero--centered" ${open}>
    <div class="wrap hero-inner">
      ${outline.meta.tagline ? `<p class="kicker">${esc(outline.meta.tagline)}</p>` : ""}
      <h1>${head}</h1>
      <div class="sk sk-line" style="width:62%"></div>
      <div class="sk sk-line" style="width:46%"></div>
      <div class="sk sk-btn"></div>
    </div>
  </section>`;
  }
  const alt = index % 2 ? "band-alt" : "";
  return `
  <section class="band ${alt}" ${open}>
    <div class="wrap">
      <h2 class="sec-title">${head}</h2>
      <div class="grid grid-3"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
    </div>
  </section>`;
}

/** Skeleton body for an outline: real theme + headlines, shimmer placeholders. */
export function renderOutlineBody(outline: SiteOutline): string {
  const sections = outline.sections.map((s, i) => renderOutlineSection(s, outline, i)).join("\n");
  return `<div class="skeleton">${sections}
  <footer class="site-footer"><div class="wrap">© ${esc(outline.meta.name)}</div></footer></div>`;
}

/** CSS for the skeleton: the document theme CSS plus shimmer styles. */
export function renderOutlineCss(outline: SiteOutline): string {
  return renderCss(outline.theme) + SKELETON_CSS;
}

/** A complete standalone HTML document (used for publish + export). */
export function renderDocumentFull(doc: SiteDocument): string {
  const t = tokens(doc.theme);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(doc.meta.name)}${doc.meta.tagline ? ` | ${esc(doc.meta.tagline)}` : ""}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${t.fontImport}&display=swap" rel="stylesheet">
  <style>${renderCss(doc.theme)}</style>
</head>
<body>
${renderDocumentBody(doc)}
</body>
</html>`;
}
