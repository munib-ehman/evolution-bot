import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite');
const db = new PGlite();
const sellerA = '11111111-1111-4111-8111-111111111111';
const sellerB = '22222222-2222-4222-8222-222222222222';
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to anon, authenticated; insert into auth.users values ('${sellerA}'), ('${sellerB}');`);
await db.exec(fs.readFileSync('supabase/2026-10-21_agent_network.sql', 'utf8'));
const draft = { agent: 'Signal', owner: 'Builder A', audience: 'Solo founders', role: 'Research brief', price: 25, currency: 'USD', sellerReportedHires: 12, checkoutUrl: 'https://agent.example/checkout', autonomyClaimed: true, text: 'A completed task', sample: 'A supplied result' };
async function asSeller(id) {
  await db.exec('reset role; set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function publish(fields) {
  return db.query('select public.network_publish_post($1::jsonb) as id', [JSON.stringify(fields)]);
}
await asSeller(sellerA);
await publish(draft);
await publish({ ...draft, sellerReportedHires: 15, text: 'Another completed task' });
assert.equal((await db.query('select * from public.network_agents')).rows.length, 1);
let result = await db.query('select posts.id, agent.id as agent_id, agent.seller_reported_hires from public.network_posts posts join public.network_agents agent on agent.id = posts.agent_id');
assert.equal(result.rows.length, 2);
assert(result.rows.every(row => row.seller_reported_hires === 15));
const agentA = result.rows[0].agent_id;
await assert.rejects(publish({ ...draft, sample: ' ' }));
assert.equal((await db.query('select seller_reported_hires from public.network_agents')).rows[0].seller_reported_hires, 15);
assert.equal((await db.query('select id from public.network_posts')).rows.length, 2);
await assert.rejects(publish({ ...draft, sellerReportedHires: -1 }));
await assert.rejects(publish({ ...draft, sellerReportedHires: 1.5 }));
await assert.rejects(publish({ ...draft, price: 1.234 }));
await assert.rejects(publish({ ...draft, checkoutUrl: 'javascript:alert(1)' }));
await assert.rejects(publish({ ...draft, autonomyClaimed: false }));
await asSeller(sellerB);
await db.query('update public.network_agents set seller_reported_hires = 999 where id = $1', [agentA]);
assert.equal((await db.query('select seller_reported_hires from public.network_agents where id = $1', [agentA])).rows[0].seller_reported_hires, 15);
await assert.rejects(db.query('insert into public.network_posts(agent_id, seller_id, task, result) values ($1, $2, $3, $4)', [agentA, sellerB, 'Spoof task', 'Spoof result']));
await publish({ ...draft, owner: 'Builder B', sellerReportedHires: 3 });
assert.equal((await db.query('select id from public.network_agents')).rows.length, 2);
assert.equal((await db.query('select id from public.network_posts')).rows.length, 3);
await db.exec('reset role; set role anon;');
assert.equal((await db.query('select id from public.network_posts')).rows.length, 3);
await assert.rejects(publish(draft));
await assert.rejects(db.query('update public.network_agents set seller_reported_hires = 999'));
await db.close();
console.log('PASS: migration, direct atomic publication, counts across posts, invalid-input rollback, authenticated ownership, cross-seller isolation, anonymous read-only access.');
