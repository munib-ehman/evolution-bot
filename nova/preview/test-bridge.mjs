import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {forward} from './api/bridge.mjs';
async function invoke(route,method='GET',body='',fetcher=()=>{throw Error('unexpected upstream request');},headers={}){
 const req=Readable.from(body?[Buffer.from(body)]:[]);Object.assign(req,{url:'/api/bridge?route='+encodeURIComponent(route),method,headers:{host:'nova.example',...headers}});
 const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(value){this.body=Buffer.from(value).toString();}};
 await forward(req,res,fetcher);return res;
}
test('Public status stays closed without a backend',async()=>{delete process.env.NOVA_BACKEND_URL;const res=await invoke('public/status');assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).checkout_ready,false);});
test('No backend cannot accept a payment',async()=>{delete process.env.NOVA_BACKEND_URL;const res=await invoke('signup/checkout','POST','{}');assert.equal(res.statusCode,503);});
test('Private admin routes and unexpected methods are rejected',async()=>{assert.equal((await invoke('local/state')).statusCode,404);assert.equal((await invoke('signup/checkout')).statusCode,405);});
test('Signed webhook body is forwarded unchanged; private authorization is excluded',async()=>{
 process.env.NOVA_BACKEND_URL='https://operator.example';const raw='{ "event": "evt1" }';
 const res=await invoke('webhooks/stripe','POST',raw,async(url,options)=>{assert.equal(url.href,'https://operator.example/webhooks/stripe');assert.equal(options.body.toString(),raw);assert.equal(options.headers['stripe-signature'],'signature');assert.equal(options.headers.authorization,undefined);assert.equal(options.redirect,'error');return new Response('{"status":"ok"}');},{'stripe-signature':'signature',authorization:'private'});assert.equal(res.statusCode,200);
});
test('Callbacks preserve query bindings',async()=>{
 process.env.NOVA_BACKEND_URL='https://operator.example';const req=Readable.from([]);Object.assign(req,{url:'/api/bridge?route=webhooks%2Fcall&owner_call=approved&event=event1',method:'POST',headers:{}});
 const res={statusCode:200,setHeader(){},end(){}};await forward(req,res,async url=>{assert.equal(url.searchParams.get('owner_call'),'approved');assert.equal(url.searchParams.get('event'),'event1');assert.equal(url.searchParams.has('route'),false);return new Response('<Response/>');});
});
test('Insecure backend, self-forwarding and oversized requests fail closed',async()=>{
 process.env.NOVA_BACKEND_URL='http://operator.example';assert.equal((await invoke('public/status')).statusCode,503);
 process.env.NOVA_BACKEND_URL='https://nova.example';assert.equal((await invoke('public/status')).statusCode,503);
 process.env.NOVA_BACKEND_URL='https://operator.example';assert.equal((await invoke('signup/checkout','POST','x'.repeat(1000001))).statusCode,413);
});
