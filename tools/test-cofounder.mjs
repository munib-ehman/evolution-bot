import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,entries:[]}});
const original=globalThis.fetch;
try{
 const {getAssistantReply}=await server.ssrLoadModule('/src/llm/client.ts');
 const {ROLES,founderPrompt}=await server.ssrLoadModule('/src/cofounder/model.ts');
 assert.deepEqual(Object.keys(ROLES),['CPO','CTO','CFO','CMO']);
 const prompt=founderPrompt('CTO','A garden planner','Approved scope: save harvests');
 assert(prompt.includes('A garden planner'));assert(prompt.includes('unexecuted draft'));
 let calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return new Response('not configured',{status:503});};
 await assert.rejects(getAssistantReply([{role:'user',content:'Plan this'}],[],{requireProxy:true,systemPrompt:prompt}),/unavailable/);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/chat');assert.equal(calls[0].body.messages[0].content,prompt);
 assert(!calls[0].body.messages[0].content.includes('Here are the catalog products'));
 globalThis.fetch=async()=>new Response('denied',{status:401});
 await assert.rejects(getAssistantReply([{role:'user',content:'Retry'}],[],{requireProxy:true,systemPrompt:prompt}),/401/);
 let chunks='';globalThis.fetch=async()=>Response.json({choices:[{message:{content:'A concrete implementation draft.'}}]});
 const reply=await getAssistantReply([{role:'user',content:'Retry'}],[],{requireProxy:true,systemPrompt:prompt,onToken:t=>chunks+=t});
 assert.equal(reply,'A concrete implementation draft.');assert.equal(chunks,reply);
 console.log('PASS: four co-founder roles, shared idea/context, authenticated proxy path, no catalog or mock fallbacks, retry after unavailable service, real response delivery.');
}finally{globalThis.fetch=original;await server.close();}
