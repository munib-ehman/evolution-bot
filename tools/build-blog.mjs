/**
 * Blog generator — compiles content/blog/*.md into branded static pages.
 *
 * Runs before `vite build` (and before `vite dev` via predev), so the output
 * lands in public/ and ships with the site:
 *   content/blog/{slug}.md  →  public/blog/{slug}.html   (/blog/{slug} via cleanUrls)
 *                            →  public/blog/index.html    (the unlinked hub)
 *                            →  public/sitemap.xml        (static pages + articles)
 *
 * Search-only by design: nothing in the main site's nav or footer links here.
 * Discovery is the sitemap plus article↔article cross-links (each page auto-
 * appends "More from the blog"), per the search-only blog spec.
 *
 * Frontmatter contract (the daily automation writes this):
 *   title:       SEO title, contains the target keyword   (required)
 *   description: meta description, ~150–160 chars          (required)
 *   slug:        URL slug, /blog/{slug}                    (required)
 *   date:        YYYY-MM-DD first published                (required)
 *   updated:     YYYY-MM-DD last edit                      (optional)
 * A leading `# H1` in the body is dropped (the template renders the title).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content", "blog");
const OUT = path.join(ROOT, "public", "blog");
const SITE = "https://www.runevolution.io";

/** Static site pages and their last meaningful edit, for the sitemap. */
const STATIC_PAGES = [
  { loc: "/", lastmod: "2026-07-16" },
  { loc: "/audit", lastmod: "2026-07-15" },
  { loc: "/pricing", lastmod: "2026-07-16" },
  { loc: "/faq", lastmod: "2026-07-15" },
  { loc: "/contact", lastmod: "2026-07-15" },
  { loc: "/terms", lastmod: "2026-07-15" },
  { loc: "/privacy", lastmod: "2026-07-15" },
  { loc: "/refund", lastmod: "2026-07-15" },
];

const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error(`${file}: missing frontmatter block`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  for (const key of ["title", "description", "slug", "date"]) {
    if (!meta[key]) throw new Error(`${file}: frontmatter is missing "${key}"`);
  }
  if (!/^[a-z0-9-]+$/.test(meta.slug)) throw new Error(`${file}: slug must be kebab-case`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${file}: date must be YYYY-MM-DD`);
  let body = raw.slice(m[0].length);
  // The template renders the title as the H1; drop a duplicate from the body.
  body = body.replace(/^\s*#\s+.+\r?\n/, "");
  return { ...meta, body };
}

const prettyDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });

/* Shared page chrome — same brand system as the rest of the public site. */
const BUTTERFLY = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5.5c-1-1.6-2.7-2.6-4.6-2.6C4.9 2.9 3 4.8 3 7.2c0 2.2 1.5 3.6 3.4 4.4C4.4 12 3 13.2 3 15.2c0 2.1 1.7 3.7 3.8 3.7 2.3 0 4.2-1.6 5.2-3.8V5.5z"/><path d="M12 5.5c1-1.6 2.7-2.6 4.6-2.6 2.5 0 4.4 1.9 4.4 4.3 0 2.2-1.5 3.6-3.4 4.4 2 .4 3.4 1.6 3.4 3.6 0 2.1-1.7 3.7-3.8 3.7-2.3 0-4.2-1.6-5.2-3.8V5.5z" opacity="0.72"/><circle cx="12" cy="4.4" r="1.5"/></svg>`;

const header = (current) => `    <header class="page-header">
      <a href="/">
        <span class="brand-mark">${BUTTERFLY}</span>
        <span class="wordmark">Evolution</span>
      </a>
      <nav class="top-nav" aria-label="Site">
        <a href="/blog"${current === "blog" ? ' aria-current="page"' : ""}>Blog</a>
        <a href="/audit">Free audit</a>
        <a href="/pricing">Pricing</a>
        <a href="/faq">FAQ</a>
        <a class="cta ghost" href="/app">Sign in</a>
      </nav>
    </header>`;

const footer = `    <footer class="page-footer">
      <nav>
        <a href="/">Home</a> ·
        <a href="/blog">Blog</a> ·
        <a href="/audit">Free audit</a> ·
        <a href="/pricing">Pricing</a> ·
        <a href="/faq">FAQ</a> ·
        <a href="/contact">Contact</a> ·
        <a href="/terms">Terms</a> ·
        <a href="/privacy">Privacy</a>
      </nav>
      <p>Evolution by RunEvolution</p>
    </footer>`;

const head = ({ title, description, url, extra = "" }) => `  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#fff8f0" />
  <meta name="description" content="${esc(description)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="stylesheet" href="/pages.css" />
  <title>${esc(title)}</title>

  <link rel="canonical" href="${url}" />
  <meta property="og:site_name" content="Evolution" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${SITE}/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${SITE}/og.png" />
${extra}`;

function articleHtml(a, others) {
  const url = `${SITE}/blog/${a.slug}`;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.updated || a.date,
    mainEntityOfPage: url,
    image: `${SITE}/og.png`,
    author: { "@type": "Organization", name: "Evolution", url: SITE },
    publisher: {
      "@type": "Organization",
      name: "Evolution",
      url: SITE,
      logo: { "@type": "ImageObject", url: `${SITE}/favicon.svg` },
    },
  });

  const more = others.slice(0, 3).map((o) =>
    `        <li><a href="/blog/${o.slug}">${esc(o.title)}</a></li>`).join("\n");
  const moreBlock = others.length
    ? `
      <aside class="article-more" aria-label="More from the Evolution blog">
        <h2>More from the Evolution blog</h2>
        <ul>
${more}
        </ul>
      </aside>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
${head({
    title: `${a.title} | Evolution`,
    description: a.description,
    url,
    extra: `  <meta property="og:type" content="article" />
  <meta property="article:published_time" content="${a.date}" />
  <meta property="article:modified_time" content="${a.updated || a.date}" />

  <script type="application/ld+json">
  ${jsonLd}
  </script>
`,
  })}</head>
<body>
  <div class="page">
${header("blog")}

    <main class="content article">
      <p class="effective">${prettyDate(a.date)} · The Evolution team</p>
      <h1>${esc(a.title)}</h1>
${marked.parse(a.body)}
      <div class="article-cta">
        <p><strong>Find out what your store is leaking.</strong> The audit is free and takes two minutes. No credit card, nothing to install.</p>
        <a class="cta" href="/audit">Get your free audit</a>
      </div>${moreBlock}
    </main>

${footer}
  </div>
</body>
</html>
`;
}

function indexHtml(articles) {
  const cards = articles.map((a) => `        <li class="blog-card">
          <p class="effective">${prettyDate(a.date)}</p>
          <h2><a href="/blog/${a.slug}">${esc(a.title)}</a></h2>
          <p>${esc(a.description)}</p>
        </li>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
${head({
    title: "Blog — Evolution",
    description:
      "Practical guides for Shopify and DTC store owners: recovering lost sales, support, retention, and profit. From Evolution, the AI COO for your ecommerce store.",
    url: `${SITE}/blog`,
    extra: `  <meta property="og:type" content="website" />
`,
  })}</head>
<body>
  <div class="page">
${header("blog")}

    <main class="content">
      <h1>The Evolution blog</h1>
      <p class="lede">Practical, no-fluff guides for store owners doing $50k to $5M a year.</p>
      <ul class="blog-list">
${cards}
      </ul>
    </main>

${footer}
  </div>
</body>
</html>
`;
}

function sitemapXml(articles) {
  const latest = articles.length
    ? articles.map((a) => a.updated || a.date).sort().at(-1)
    : null;
  const urls = [
    ...STATIC_PAGES.map((p) => ({ loc: `${SITE}${p.loc === "/" ? "/" : p.loc}`, lastmod: p.lastmod })),
    ...(latest ? [{ loc: `${SITE}/blog`, lastmod: latest }] : []),
    ...articles.map((a) => ({ loc: `${SITE}/blog/${a.slug}`, lastmod: a.updated || a.date })),
  ];
  const body = urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

async function main() {
  const files = (await readdir(CONTENT)).filter(
    (f) => f.endsWith(".md") && f !== "topics-queue.md" && !f.startsWith("_"),
  );
  const articles = [];
  for (const file of files) {
    const raw = await readFile(path.join(CONTENT, file), "utf8");
    articles.push(parseFrontmatter(raw, file));
  }
  const slugs = new Set();
  for (const a of articles) {
    if (slugs.has(a.slug)) throw new Error(`duplicate slug: ${a.slug}`);
    slugs.add(a.slug);
  }
  articles.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)); // newest first

  await mkdir(OUT, { recursive: true });
  for (const a of articles) {
    // Cross-link pool: the newest articles other than this one.
    const others = articles.filter((o) => o.slug !== a.slug);
    await writeFile(path.join(OUT, `${a.slug}.html`), articleHtml(a, others));
  }
  await writeFile(path.join(OUT, "index.html"), indexHtml(articles));
  await writeFile(path.join(ROOT, "public", "sitemap.xml"), sitemapXml(articles));

  console.log(`blog: built ${articles.length} article(s) + index, sitemap has ${STATIC_PAGES.length + articles.length + (articles.length ? 1 : 0)} URLs`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
