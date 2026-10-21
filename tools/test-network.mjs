import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canTry, recordTry, safeAgentUrl, sortedPosts } from '../src/network/model.mjs';

const posts = JSON.parse(fs.readFileSync(new URL('../src/network/posts.json', import.meta.url), 'utf8'));
assert.equal(new Set(posts.map(post => post.id)).size, posts.length);
for (const post of posts) {
  for (const field of ['id', 'agent', 'owner', 'text', 'input', 'output', 'sample', 'publishedAt']) {
    assert.equal(typeof post[field], 'string', field);
    assert(post[field].trim().length > 0, field);
  }
  assert(Number.isFinite(Date.parse(post.publishedAt)));
  if (post.demo) assert(post.text.length <= 140, 'Sample feed posts stay short');
  assert.equal(typeof post.demo, 'boolean');
  assert.equal(typeof post.autonomyTested, 'boolean');
  assert(Array.isArray(post.preview) && post.preview.length === 3);
  assert(['sage', 'clay', 'lavender'].includes(post.color));
  if (!post.demo) assert(canTry(post), 'Real listings require a tested autonomous task and a working HTTPS entry point');
  else assert.equal(canTry(post), false);
}
assert.equal(safeAgentUrl('javascript:alert(1)'), null);
assert.equal(safeAgentUrl('http://agent.example'), null);
assert.equal(safeAgentUrl('https://user:pass@agent.example'), null);
assert.equal(safeAgentUrl('/app'), null);
assert.equal(safeAgentUrl(null), null);
assert.equal(safeAgentUrl('https://agent.example/task'), 'https://agent.example/task');
const agent = { ...posts[0], demo: false, autonomyTested: true, tryUrl: 'https://agent.example/task' };
assert(canTry(agent));
assert(!canTry({ ...agent, autonomyTested: false }));
assert(!canTry({ ...agent, demo: true }));
assert(!canTry({ ...agent, tryUrl: 'javascript:alert(1)' }));
const shuffled = [...posts].reverse();
const before = [...shuffled];
assert.deepEqual(sortedPosts(shuffled).map(post => post.id), posts.map(post => post.id));
assert.deepEqual(shuffled, before);
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
assert(recordTry(storage, 'example', '2026-10-21T12:00:00Z'));
assert.deepEqual(JSON.parse([...values.values()][0]), [{ postId: 'example', at: '2026-10-21T12:00:00Z', event: 'try_clicked' }]);
assert(!recordTry(null, 'example'));
assert(!recordTry({ getItem() { throw Error('blocked'); } }, 'example'));
storage.setItem('evolution:network:try-clicks:v1', '{}');
assert(recordTry(storage, 'example'));
storage.setItem('evolution:network:try-clicks:v1', 'invalid');
assert(!recordTry(storage, 'example'));
storage.setItem('evolution:network:try-clicks:v1', JSON.stringify(Array.from({ length: 600 }, () => ({}))));
assert(recordTry(storage, 'example'));
assert.equal(JSON.parse([...values.values()][0]).length, 500);
assert.equal(JSON.parse(fs.readFileSync('vercel.json', 'utf8')).git.deploymentEnabled, false);
if (fs.existsSync('dist/index.html')) {
  assert.equal(JSON.parse(fs.readFileSync('dist/site-version.json', 'utf8')).version, 'network');
  for (const file of ['dist/index.html', 'dist/app.html']) {
    const html = fs.readFileSync(file, 'utf8');
    assert(html.includes('agents, open for work.'));
    assert(!html.includes('/src/network/'));
    assert(!html.includes('shopify-api-key'));
  }
  for (const file of ['blog', 'audit.html', 'pricing.html', 'models', 'products.json']) assert(!fs.existsSync('dist/' + file));
  assert.equal(fs.readFileSync('dist/robots.txt', 'utf8').trim(), 'User-agent: *\nDisallow: /');
  assert.deepEqual(fs.readFileSync('dist/favicon.svg'), fs.readFileSync('public/favicon.svg'));
}
console.log('PASS: listing integrity, demo safeguards, autonomous-entry gate, safe URLs, feed order, optional bounded local click events, no automatic deployment.');
