import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { analyzeSeoProduct, runSeoSnapshot } = await server.ssrLoadModule("/api/_seoManager.ts");
  const base = { id:"gid://shopify/Product/1", title:"Complete product", status:"active", descChars:400, images:2, imagesNoAlt:0, tags:5, seoTitleQuality:"ok", seoDescriptionQuality:"ok", seoTitleChars:45, seoDescriptionChars:140, vendor:true, productType:true, geoReady:true };
  assert.deepEqual(analyzeSeoProduct(base), { id:base.id, title:base.title, status:"active", seoScore:100, geoScore:100, issues:[] });
  const empty = analyzeSeoProduct({ ...base, title:"Empty product", descChars:0, images:0, tags:0, seoTitleQuality:"missing", seoDescriptionQuality:"missing", seoTitleChars:0, seoDescriptionChars:0, vendor:false, productType:false, geoReady:false });
  assert.equal(empty.seoScore, 22);
  assert.equal(empty.geoScore, 6);
  assert.ok(empty.issues.includes("Missing search title"));
  assert.ok(empty.issues.includes("Missing product type"));
  const thin = analyzeSeoProduct({ ...base, descChars:100, imagesNoAlt:2, tags:1, seoDescriptionQuality:"thin", geoReady:false });
  assert.equal(thin.seoScore, 68);
  assert.equal(thin.geoScore, 57);
  assert.ok(thin.issues.some((issue) => issue.includes("missing alt text")));
  const { forcedProposalTool, selectedAgentToolNames } = await server.ssrLoadModule("/api/_agentChat.ts");
  const seoTurn = [{ role:"user", content:"Prepare an SEO approval for gid://shopify/Product/1" }];
  const selected = selectedAgentToolNames(seoTurn);
  assert.ok(selected.includes("get_products"));
  assert.ok(selected.includes("get_product_detail"));
  assert.ok(selected.includes("prepare_product_updates"));
  assert.equal(forcedProposalTool(seoTurn), null, "SEO must fetch product detail before proposing an update");
  assert.equal(forcedProposalTool([{role:"user",content:"Create a discount in my store"}]), "prepare_discount");
  const env = { supabaseUrl:"https://supabase.test", serviceRoleKey:"service", adminEmails:"owner@example.com" };
  assert.equal((await runSeoSnapshot(null, env)).status, 401);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/auth/v1/user")) return Response.json({id:"user-1",email:"owner@example.com"});
    if (String(url).includes("shopify_connections")) return Response.json([{shop_domain:"demo.myshopify.com",access_token:"token",scopes:"read_products,write_products"}]);
    if (String(url).includes("graphql.json")) return Response.json({data:{products:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{id:base.id,title:"Incomplete",status:"ACTIVE",descriptionHtml:"",tags:[],handle:"incomplete",vendor:"",productType:"",seo:{title:null,description:null},mediaCount:{count:0},media:{nodes:[]},variants:{nodes:[]}}]}}});
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await runSeoSnapshot("Bearer session", env);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.scanned, 1);
    assert.equal(snapshot.needsWork, 1);
    assert.equal(snapshot.products[0].title, "Incomplete");
    assert.ok(calls.some(url=>url.includes("graphql.json")));
  } finally { globalThis.fetch = originalFetch; }

  const { runAgentChat } = await server.ssrLoadModule("/api/_agentChat.ts");
  const chatEvents = [];
  let groqRound = 0;
  globalThis.fetch = async (url, init={}) => {
    const target = String(url); const method = init.method ?? "GET"; const requestBody = init.body ? JSON.parse(init.body) : {};
    chatEvents.push({target,method,requestBody});
    if (target.endsWith("/auth/v1/user")) return Response.json({id:"user-1",email:"owner@example.com"});
    if (target.includes("shopify_connections")) return Response.json([{shop_domain:"demo.myshopify.com",access_token:"token",scopes:"read_products,write_products"}]);
    if (target.includes("business_memory") || target.includes("chat_messages")) return Response.json([]);
    if (target.includes("profiles")) return Response.json([{plan:"operator"}]);
    if (target.includes("graphql.json")) {
      if (String(requestBody.query).includes("SeoProduct")) return Response.json({data:{product:{id:base.id,title:"Canvas Bag",descriptionHtml:"<p>Heavy canvas tote.</p>",vendor:"Demo",productType:"Bag",tags:["canvas","bag"],seo:{title:null,description:null},media:{nodes:[]}}}});
      return Response.json({data:{nodes:[{id:base.id,updatedAt:"2026-08-11T00:00:00Z",title:"Canvas Bag",descriptionHtml:"<p>Heavy canvas tote.</p>",tags:["canvas","bag"],status:"ACTIVE",vendor:"Demo",productType:"Bag",seo:{title:null,description:null},media:{nodes:[]}}]}});
    }
    if (target.includes("shopify_actions") && method === "POST") return Response.json([{id:"action-1",kind:"product_update",status:"proposed",summary:"Improve Canvas Bag SEO",payload:requestBody.items?requestBody:{items:[{productId:base.id,seoTitle:"Canvas Bag | Demo",seoDescription:"Shop the Demo heavy canvas tote bag."}]},before_state:{products:[]},expires_at:"2026-08-12T00:00:00Z",created_at:"2026-08-11T00:00:00Z"}]);
    if (target.includes("action_events") || target.includes("store_events")) return new Response(null,{status:201});
    if (target.includes("api.groq.com")) {
      groqRound++;
      if (groqRound===1) return Response.json({choices:[{message:{content:null,tool_calls:[{id:"detail-1",type:"function",function:{name:"get_product_detail",arguments:JSON.stringify({productId:base.id})}}]}}]});
      if (groqRound===2) return Response.json({choices:[{message:{content:null,tool_calls:[{id:"proposal-1",type:"function",function:{name:"prepare_product_updates",arguments:JSON.stringify({summary:"Improve Canvas Bag SEO",items:[{productId:base.id,seoTitle:"Canvas Bag | Demo",seoDescription:"Shop the Demo heavy canvas tote bag."}]})}}]}}]});
      return Response.json({choices:[{message:{content:"I prepared a grounded SEO proposal for your approval."}}]});
    }
    throw new Error(`Unexpected chat fetch: ${target}`);
  };
  try {
    const chatResponse = await runAgentChat({messages:[{role:"user",content:`Prepare an SEO approval for ${base.id}`} ]},"Bearer session","https://app.test",{...env,groqKey:"groq",groqModel:"test-model"});
    assert.equal(chatResponse.status,200);
    const stream = await chatResponse.text();
    assert.match(stream,/"action"/);
    assert.match(stream,/grounded SEO proposal/);
    const detailIndex = chatEvents.findIndex(event=>String(event.requestBody.query??"").includes("SeoProduct"));
    const proposalIndex = chatEvents.findIndex(event=>event.target.includes("shopify_actions")&&event.method==="POST");
    assert.ok(detailIndex>=0&&proposalIndex>detailIndex,"chat must fetch exact product details before saving an SEO proposal");
  } finally { globalThis.fetch = originalFetch; }
  console.log("SEO manager scoring tests passed");
} finally {
  await server.close();
}
