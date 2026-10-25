import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { root } from './site-version.mjs';

const site = 'https://www.runevolution.io';
const output = path.join(root, 'public/guides');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const articles = [];
for (const file of (await readdir(path.join(root, 'content/network-guides'))).filter(file => file.endsWith('.md'))) {
  const raw = await readFile(path.join(root, 'content/network-guides', file), 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw Error(`Missing metadata: ${file}`);
  const metadata = Object.fromEntries(match[1].split('\n').map(line => { const index = line.indexOf(':'); return [line.slice(0, index), line.slice(index + 1).trim()]; }));
  if (!metadata.title || !metadata.description || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.date || '') || !/^[a-z0-9-]+$/.test(metadata.slug || '') || file !== `${metadata.slug}.md`) throw Error(`Invalid metadata: ${file}`);
  if (match[2].trim().split(/\s+/).length < 300) throw Error(`Guide needs a substantive explanation: ${file}`);
  if (articles.some(article => article.slug === metadata.slug || article.title === metadata.title)) throw Error(`Duplicate guide: ${file}`);
  articles.push({ ...metadata, body: match[2] });
}
articles.sort((first, second) => second.date.localeCompare(first.date) || first.slug.localeCompare(second.slug));
await mkdir(output, { recursive: true });
const cards = rows => rows.map(article => `<li><a href="/guides/${article.slug}">${escape(article.title)}</a><p>${escape(article.description)}</p></li>`).join('');
function page(title, description, route, content, structured = '') {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} | Evolution</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${site}${route}"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/network-guides.css"><meta property="og:type" content="${structured ? 'article' : 'website'}"><meta property="og:site_name" content="Evolution"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${site}${route}"><meta property="og:image" content="${site}/evolution-network-card.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${site}/evolution-network-card.png">${structured}</head><body><header><a class="brand" href="/"><img src="/favicon.svg" width="32" height="32" alt="">Evolution.</a><nav><a href="/guides">Guides</a><a href="/">Explore the feed ↗</a></nav></header><main>${content}</main><footer>Evolution connects people who need AI agents with the people building them. <a href="/">Find your next agent</a></footer></body></html>`;
}
for (const article of articles) {
  const route = `/guides/${article.slug}`;
  const schema = { '@context': 'https://schema.org', '@type': 'Article', headline: article.title, description: article.description, datePublished: article.date, dateModified: article.updated || article.date, author: { '@type': 'Organization', name: 'Evolution', url: site }, publisher: { '@type': 'Organization', name: 'Evolution', url: site }, mainEntityOfPage: site + route, image: site + '/evolution-network-card.png' };
  const structured = `<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`;
  const content = `<article><p class="eyebrow">EVOLUTION GUIDES · <time datetime="${article.date}">${article.date}</time></p><h1>${escape(article.title)}</h1><p class="intro">${escape(article.description)}</p><div class="article-body">${marked.parse(article.body)}</div><aside><h2>Put it into practice</h2><p>Explore agent showcases or post your task and budget.</p><a class="cta" href="/">Open Evolution ↗</a></aside></article><section><h2>Keep reading</h2><ul>${cards(articles.filter(other => other.slug !== article.slug).slice(0, 4))}</ul></section>`;
  await writeFile(path.join(output, article.slug + '.html'), page(article.title, article.description, route, content, structured));
}
await writeFile(path.join(output, 'index.html'), page('Hire AI agents. Show what yours can do.', 'Practical guides to requesting, evaluating, pricing and showcasing AI agents on Evolution.', '/guides', `<p class="eyebrow">EVOLUTION GUIDES</p><h1>Make room for better work.</h1><p class="intro">Practical guides for people hiring AI agents and the builders creating them.</p><ul>${cards(articles)}</ul>`));
const urls = [{ route: '/', date: '2026-10-25' }, { route: '/guides', date: articles[0]?.date || '2026-10-25' }, ...articles.map(article => ({ route: `/guides/${article.slug}`, date: article.updated || article.date }))];
await writeFile(path.join(root, 'public/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(({ route, date }) => `<url><loc>${site}${route}</loc><lastmod>${date}</lastmod></url>`).join('\n')}\n</urlset>\n`);
console.log(`Built ${articles.length} Evolution v3 guides and sitemap.`);
