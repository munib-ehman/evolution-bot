import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = await mkdtemp(join(tmpdir(),'evolution-mail-test-'));
try {
  const output = join(folder,'handler.mjs');
  await build({entryPoints:['api/job-notifications.ts'],outfile:output,bundle:true,platform:'node',format:'esm'});
  Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-service',RESEND_API_KEY:'test-resend',CRON_SECRET:'test-cron'});
  const {default:handler} = await import(pathToFileURL(output).href);
  const originalFetch = globalThis.fetch;
  const messages = [];
  const patches = [];
  let providerStatus = 200;
  globalThis.fetch = async (url,options={}) => {
    if(String(url).endsWith('/auth/v1/user')) return Response.json({id:'actor',email:'actor@example.com'});
    if(String(url).includes('/rpc/evolution_claim_mail')) {
      assert.equal(JSON.parse(options.body).actor,'actor');
      return Response.json([{id:'mail-id',recipient_id:'recipient',subject:'Application: Stock report',body:'Developer: Test\nProposal: I can help',reply_to:'developer@example.com'}]);
    }
    if(String(url).includes('/evolution_users?')) return Response.json([{email:'business@example.com'}]);
    if(String(url).includes('api.resend.com')) { messages.push(JSON.parse(options.body)); assert.equal(options.headers['Idempotency-Key'],'evolution-job-mail-id'); return Response.json({id:'provider-id'},{status:providerStatus}); }
    if(String(url).includes('/evolution_mail_queue?')) { patches.push(JSON.parse(options.body)); return new Response(null,{status:204}); }
    throw new Error('Unexpected request');
  };
  try {
    assert.equal((await handler(new Request('https://www.runevolution.io/api/job-notifications'))).status,401);
    assert.equal((await handler(new Request('https://www.runevolution.io/api/job-notifications',{method:'POST',headers:{origin:'https://other.example'}}))).status,401);
    const request = () => new Request('https://www.runevolution.io/api/job-notifications',{method:'POST',headers:{authorization:'Bearer user-token'}});
    assert.equal((await handler(request())).status,200);
    assert.equal(messages[0].reply_to,'developer@example.com');
    assert.deepEqual(messages[0].to,['business@example.com']);
    assert.deepEqual(patches[0],{state:'sent',provider_id:'provider-id'});
    providerStatus=403;
    assert.equal((await handler(request())).status,502);
    assert.equal(patches[1].state,'failed');
    providerStatus=429;
    assert.equal((await handler(request())).status,502);
    assert.equal(patches[2].state,'pending');
    providerStatus=500;
    assert.equal((await handler(request())).status,502);
    assert.equal(patches[3].state,'uncertain');
    process.env.RESEND_API_KEY='';
    assert.equal((await handler(request())).status,503);
  } finally { globalThis.fetch=originalFetch; }
  console.log('PASS: sender authentication, same-origin guard, recipient isolation, direct reply-to, stable provider idempotency, accepted-message recording and fail-closed delivery configuration.');
} finally { await rm(folder,{recursive:true,force:true}); }
