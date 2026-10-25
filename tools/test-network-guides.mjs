import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
import './build-network-guides.mjs';

const files = fs.readdirSync('content/network-guides').filter(file => file.endsWith('.md'));
assert(files.length >= 5);
const sitemap = fs.readFileSync('versions/network/public/sitemap.xml', 'utf8');
assert.equal(fs.readFileSync('dist/sitemap.xml', 'utf8'), sitemap);
for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  const html = fs.readFileSync(`public/guides/${slug}.html`, 'utf8');
  assert(html.includes(`https://www.runevolution.io/guides/${slug}`));
  assert(html.includes('application/ld+json'));
  assert(html.includes('summary_large_image'));
  assert(!html.includes('Open Evolution ↗'));
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert(sitemap.includes(`/guides/${slug}</loc>`));
}
assert(!sitemap.includes('/owner-analytics'));
assert(!sitemap.includes('https://www.runevolution.io/audit</loc>'));
for (const file of fs.readdirSync('content/blog').filter(file => file.endsWith('.md') && file !== 'topics-queue.md')) {
  const source = fs.readFileSync(`content/blog/${file}`, 'utf8');
  const slug = source.match(/^slug:\s*(.+)$/m)[1].trim();
  const date = source.match(/^date:\s*(.+)$/m)[1].trim();
  const archive = fs.readFileSync(`dist/blog/${slug}.html`, 'utf8');
  assert(archive.includes(`https://www.runevolution.io/blog/${slug}`));
  assert(archive.includes(`datetime="${date}"`));
  assert(sitemap.includes(`/blog/${slug}</loc>`));
}
const robots = fs.readFileSync('dist/robots.txt', 'utf8');
assert(!/^Disallow: \/$/m.test(robots));
assert(robots.includes('Sitemap: https://www.runevolution.io/sitemap.xml'));
const home = fs.readFileSync('versions/network/index.html', 'utf8');
assert(home.includes('name="twitter:card" content="summary_large_image"'));
assert(home.includes('evolution-network-card.png'));
assert(fs.statSync('public/evolution-network-card.png').size > 1000);
postcss.parse(fs.readFileSync('public/network-guides.css', 'utf8'));
console.log('PASS: substantive v3 guide sources, static pages, canonical URLs, article schema, sitemap and social card metadata.');
