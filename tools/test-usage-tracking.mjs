import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const saved = new Map(['localStorage','sessionStorage','__evolutionTrackingTest'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
function storage() {
  const values = new Map();
  return { getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,String(value)), removeItem:key=>values.delete(key) };
}
const events = [];
try {
  Object.defineProperty(globalThis,'localStorage',{value:storage(),configurable:true});
  Object.defineProperty(globalThis,'sessionStorage',{value:storage(),configurable:true});
  Object.defineProperty(globalThis,'__evolutionTrackingTest',{value:{rpc:async (name,input)=>{assert.equal(name,'evolution_record_event');events.push(input.event_input);return {error:null};}},configurable:true});
  const source = fs.readFileSync(new URL('../src/jobs/analytics.ts',import.meta.url),'utf8').replace("import { supabase } from '../lib/auth';",'const supabase = globalThis.__evolutionTrackingTest;');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  const tracking = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
  const settle = async () => { await new Promise(resolve=>setImmediate(resolve)); };
  tracking.trackUsage('board_view'); await settle(); assert.equal(events.length,0);
  tracking.changeUsageConsent(false); tracking.trackUsage('board_view'); await settle(); assert.equal(events.length,0);
  tracking.changeUsageConsent(true); tracking.trackUsage('board_view'); tracking.trackUsage('board_view'); await settle(); assert.equal(events.length,1);
  const firstVisitor = events[0].visitorId;
  tracking.usageActor('11111111-1111-4111-8111-111111111111'); tracking.trackUsage('signed_in'); await settle();
  assert.equal(events[1].visitorId,firstVisitor);
  tracking.trackUsage('request_open','22222222-2222-4222-8222-222222222222'); await settle();
  assert.equal(events[2].jobId,'22222222-2222-4222-8222-222222222222');
  assert.deepEqual(Object.keys(events[2]).sort(),['consented','id','jobId','name','sessionId','visitorId','visitorToken'].sort());
  tracking.usageActor(null); tracking.trackUsage('board_view'); await settle();
  assert.notEqual(events[3].visitorId,firstVisitor);
  tracking.changeUsageConsent(false); tracking.trackUsage('request_start'); await settle(); assert.equal(events.length,4);
  assert.equal(sessionStorage.getItem('evolution:journey:v1'),null);
  console.log('PASS: opt-in only, opt-out respected, session deduplication, login continuity, logout identity rotation and no form values/emails/URLs in event payloads.');
} finally {
  for (const [key,descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; }
}
