// ============================================================================
// The Renderer — turns a typed Site Document into a complete, beautiful website.
//
// This is where DESIGN QUALITY lives. The AI never writes markup; it fills a
// document, and these hand-crafted templates render it. That means output can
// never be a broken build or a security hole, and it never looks like AI slop.
// ============================================================================
import type { SiteDocument, Section, Theme } from "@shared/site-document";

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
};

const RADIUS: Record<string, string> = {
  none: "0px", small: "6px", medium: "12px", large: "20px", pill: "9999px",
};

function tokens(theme: Theme): ThemeTokens {
  const base = PRESETS[theme.preset] ?? PRESETS["warm-editorial"];
  // Honor a narrow accent override without wrecking contrast.
  return theme.accent ? { ...base, accent: theme.accent } : base;
}

// ---- Small HTML helpers ----
function esc(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
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

// ---- Per-section templates ----
// index is the section's position in doc.sections — injected as data-section-key.
function renderSection(section: Section, doc: SiteDocument, index: number): string {
  const key = `${index}:${section.type}`;
  switch (section.type) {
    case "hero":
      return `
  <section class="hero" data-section-key="${key}">
    <div class="wrap hero-inner">
      ${doc.meta.tagline ? `<p class="kicker">${esc(doc.meta.tagline)}</p>` : ""}
      <h1>${esc(section.headline)}</h1>
      ${section.subheadline ? `<p class="lead">${esc(section.subheadline)}</p>` : ""}
      ${section.cta ? `<a class="btn btn-primary" href="${ctaHref(section.cta.action, section.cta.href, doc)}">${esc(section.cta.label)}</a>` : ""}
    </div>
  </section>`;

    case "services":
      return `
  <section class="band" data-section-key="${key}">
    <div class="wrap">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="grid grid-3">
        ${section.items.map((it) => `
        <div class="card">
          <h3>${esc(it.name)}</h3>
          <p>${esc(it.description)}</p>
        </div>`).join("")}
      </div>
    </div>
  </section>`;

    case "menu":
      return `
  <section class="band band-alt" data-section-key="${key}">
    <div class="wrap wrap-narrow">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="menu-list">
        ${section.items.map((it) => `
        <div class="menu-row">
          <div class="menu-row-main">
            <span class="menu-name">${esc(it.name)}</span>
            ${it.price ? `<span class="menu-dots"></span><span class="menu-price">${esc(it.price)}</span>` : ""}
          </div>
          ${it.description ? `<p class="menu-desc">${esc(it.description)}</p>` : ""}
        </div>`).join("")}
      </div>
    </div>
  </section>`;

    case "products":
      return `
  <section class="band" data-section-key="${key}">
    <div class="wrap">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="grid grid-3">
        ${section.items.map((it) => `
        <div class="product">
          <div class="product-img"></div>
          <div class="product-body">
            <h3>${esc(it.name)}</h3>
            ${it.description ? `<p>${esc(it.description)}</p>` : ""}
            ${it.price ? `<span class="product-price">${esc(it.price)}</span>` : ""}
          </div>
        </div>`).join("")}
      </div>
    </div>
  </section>`;

    case "about":
      return `
  <section class="band band-alt" data-section-key="${key}">
    <div class="wrap wrap-narrow about">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <p class="about-body">${esc(section.body)}</p>
    </div>
  </section>`;

    case "gallery":
      return `
  <section class="band" data-section-key="${key}">
    <div class="wrap">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="gallery">
        ${section.imageHints.map(() => `<div class="gallery-cell"></div>`).join("")}
      </div>
    </div>
  </section>`;

    case "testimonials":
      return `
  <section class="band band-alt" data-section-key="${key}">
    <div class="wrap">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="grid grid-3">
        ${section.items.map((it) => `
        <figure class="quote">
          <blockquote>${esc(it.quote)}</blockquote>
          <figcaption>${esc(it.author)}${it.role ? `<span>${esc(it.role)}</span>` : ""}</figcaption>
        </figure>`).join("")}
      </div>
    </div>
  </section>`;

    case "contact":
      return `
  <section class="band" id="contact" data-section-key="${key}">
    <div class="wrap wrap-narrow contact">
      <h2 class="sec-title">${esc(section.title)}</h2>
      <div class="contact-grid">
        <div class="contact-info">
          ${section.phone ? `<p><strong>Call</strong><a href="tel:${esc(section.phone).replace(/[^0-9+]/g, "")}">${esc(section.phone)}</a></p>` : ""}
          ${section.email ? `<p><strong>Email</strong><a href="mailto:${esc(section.email)}">${esc(section.email)}</a></p>` : ""}
          ${section.address ? `<p><strong>Visit</strong>${esc(section.address)}</p>` : ""}
          ${section.hours ? `<p><strong>Hours</strong>${esc(section.hours)}</p>` : ""}
        </div>
        ${section.showForm ? `
        <form class="contact-form" action="${section.email ? `mailto:${esc(section.email)}` : "#"}" method="post" enctype="text/plain">
          <input type="text" name="name" placeholder="Your name" required />
          <input type="email" name="email" placeholder="Your email" required />
          <textarea name="message" placeholder="How can we help?" rows="4"></textarea>
          <button type="submit" class="btn btn-primary">Send message</button>
        </form>` : ""}
      </div>
    </div>
  </section>`;

    case "cta":
      return `
  <section class="cta-band" data-section-key="${key}">
    <div class="wrap cta-inner">
      <h2>${esc(section.headline)}</h2>
      <a class="btn btn-invert" href="${ctaHref(section.cta.action, section.cta.href, doc)}">${esc(section.cta.label)}</a>
    </div>
  </section>`;

    default:
      return "";
  }
}

// ---- The stylesheet (driven by theme tokens) ----
function renderCss(theme: Theme): string {
  const t = tokens(theme);
  const r = RADIUS[theme.radius] ?? RADIUS.medium;
  return `
:root {
  --bg:${t.bg}; --surface:${t.surface}; --ink:${t.ink}; --ink-soft:${t.inkSoft};
  --accent:${t.accent}; --accent-ink:${t.accentInk}; --border:${t.border}; --r:${r};
}
* { margin:0; padding:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:var(--bg); color:var(--ink); font-family:${t.bodyFont}; line-height:1.6; -webkit-font-smoothing:antialiased; }
.wrap { max-width:1140px; margin:0 auto; padding:0 24px; }
.wrap-narrow { max-width:760px; }
h1,h2,h3 { font-family:${t.displayFont}; font-weight:${t.headingWeight}; font-style:${t.headingStyle}; letter-spacing:-0.01em; line-height:1.05; }
.kicker { font-family:${t.bodyFont}; font-size:.72rem; letter-spacing:.22em; ${t.uppercaseKicker ? "text-transform:uppercase;" : ""} color:var(--accent); margin-bottom:1.25rem; font-weight:600; }
.btn { display:inline-block; padding:.95rem 2rem; border-radius:var(--r); font-weight:600; text-decoration:none; transition:transform .15s ease, opacity .15s ease; cursor:pointer; border:none; font-size:1rem; font-family:inherit; }
.btn:hover { transform:translateY(-2px); }
.btn-primary { background:var(--accent); color:var(--accent-ink); }
.btn-invert { background:var(--bg); color:var(--ink); }

/* hero */
.hero { padding:8rem 0 6rem; }
.hero-inner { max-width:780px; }
.hero h1 { font-size:clamp(2.6rem,7vw,5rem); }
.hero .lead { font-size:1.3rem; color:var(--ink-soft); margin:1.5rem 0 2.5rem; max-width:32rem; }

/* bands */
.band { padding:5rem 0; }
.band-alt { background:var(--surface); }
.sec-title { font-size:clamp(1.8rem,4vw,2.8rem); margin-bottom:2.5rem; }

/* grids */
.grid { display:grid; gap:1.5rem; }
.grid-3 { grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:2rem; }
.band-alt .card { background:var(--bg); }
.card h3 { font-size:1.4rem; margin-bottom:.6rem; }
.card p { color:var(--ink-soft); }

/* menu */
.menu-list { display:flex; flex-direction:column; gap:1.25rem; }
.menu-row-main { display:flex; align-items:baseline; gap:.5rem; }
.menu-name { font-weight:600; font-size:1.15rem; }
.menu-dots { flex:1; border-bottom:1px dotted var(--border); transform:translateY(-3px); }
.menu-price { color:var(--accent); font-weight:600; }
.menu-desc { color:var(--ink-soft); font-size:.95rem; margin-top:.2rem; }

/* products */
.product { border:1px solid var(--border); border-radius:var(--r); overflow:hidden; background:var(--surface); }
.product-img { aspect-ratio:4/3; background:linear-gradient(135deg,var(--border),var(--surface)); }
.product-body { padding:1.4rem; }
.product-body h3 { font-size:1.25rem; margin-bottom:.4rem; }
.product-body p { color:var(--ink-soft); font-size:.95rem; margin-bottom:.6rem; }
.product-price { color:var(--accent); font-weight:700; font-size:1.1rem; }

/* about */
.about { text-align:center; }
.about-body { font-size:1.25rem; color:var(--ink-soft); line-height:1.8; }

/* gallery */
.gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; }
.gallery-cell { aspect-ratio:1; border-radius:var(--r); background:linear-gradient(135deg,var(--border),var(--surface)); }

/* testimonials */
.quote { background:var(--bg); border:1px solid var(--border); border-radius:var(--r); padding:2rem; }
.band-alt .quote { background:var(--surface); }
.quote blockquote { font-size:1.15rem; font-style:italic; margin-bottom:1.2rem; }
.quote figcaption { font-weight:600; }
.quote figcaption span { display:block; color:var(--ink-soft); font-weight:400; font-size:.9rem; }

/* contact */
.contact-grid { display:grid; grid-template-columns:1fr 1fr; gap:3rem; }
.contact-info p { margin-bottom:1.25rem; }
.contact-info strong { display:block; font-size:.75rem; text-transform:uppercase; letter-spacing:.12em; color:var(--accent); margin-bottom:.2rem; }
.contact-info a { color:var(--ink); text-decoration:none; font-size:1.1rem; }
.contact-form { display:flex; flex-direction:column; gap:.8rem; }
.contact-form input, .contact-form textarea { padding:.9rem 1rem; border:1px solid var(--border); border-radius:var(--r); background:var(--surface); font-family:inherit; font-size:1rem; color:var(--ink); }
.contact-form textarea { resize:vertical; }

/* cta band */
.cta-band { background:var(--accent); color:var(--accent-ink); padding:5rem 0; }
.cta-inner { display:flex; align-items:center; justify-content:space-between; gap:2rem; flex-wrap:wrap; }
.cta-band h2 { font-size:clamp(1.8rem,4vw,2.8rem); max-width:30rem; }

footer.site-footer { padding:3rem 0; border-top:1px solid var(--border); text-align:center; color:var(--ink-soft); font-size:.9rem; }

@media (max-width:720px) {
  .contact-grid { grid-template-columns:1fr; }
  .hero { padding:5rem 0 4rem; }
  .cta-inner { flex-direction:column; align-items:flex-start; }
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

/** A complete standalone HTML document (used for publish + export). */
export function renderDocumentFull(doc: SiteDocument): string {
  const t = tokens(doc.theme);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(doc.meta.name)}${doc.meta.tagline ? ` — ${esc(doc.meta.tagline)}` : ""}</title>
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
