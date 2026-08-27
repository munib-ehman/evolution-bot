import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { analyzeSeoProduct, crawlerBlocked, inspectProductPage, runSeoSnapshot } = await server.ssrLoadModule("/api/_seoManager.ts");
  const { extractMarketplaceTitles, buildKeywordCandidates, containsUnsupportedClaims, extractCatalogFacts } = await server.ssrLoadModule("/api/_seoOptimizer.ts");
  const base = { id:"gid://shopify/Product/1", title:"Complete product", status:"active", descChars:400, images:2, imagesNoAlt:0, tags:5, seoTitleQuality:"ok", seoDescriptionQuality:"ok", seoTitleChars:45, seoDescriptionChars:140, vendor:true, productType:true, geoReady:true };
  const complete = analyzeSeoProduct(base);
  assert.deepEqual({...complete,geoChecks:undefined}, { id:base.id, title:base.title, status:"active", seoScore:100, geoScore:100, issues:[], geoChecks:undefined, vendorName:"", productTypeName:"" });
  assert.ok(complete.geoChecks.every(check=>check.passed));
  assert.equal(crawlerBlocked("User-agent: *\nDisallow:\nUser-agent: OAI-SearchBot\nDisallow: /", "OAI-SearchBot"),true);
  assert.equal(crawlerBlocked("User-agent: *\nDisallow: /private", "OAI-SearchBot"),false);
  const inspected = inspectProductPage(`<html><head><link rel="canonical" href="https://demo.test/products/bag"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Bag","description":"Canvas bag","image":"bag.jpg","brand":{"@type":"Brand","name":"Demo"},"sku":"BAG-1","offers":{"@type":"Offer","price":"20.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head></html>`);
  assert.deepEqual(inspected,{canonical:true,indexable:true,productSchema:true,offerComplete:true,identityComplete:true});
  const empty = analyzeSeoProduct({ ...base, title:"Empty product", descChars:0, images:0, tags:0, seoTitleQuality:"missing", seoDescriptionQuality:"missing", seoTitleChars:0, seoDescriptionChars:0, vendor:false, productType:false, geoReady:false });
  assert.equal(empty.seoScore, 22);
  assert.equal(empty.geoScore, 6);
  assert.ok(empty.issues.includes("Missing search title"));
  assert.ok(empty.issues.includes("Missing product type"));
  const thin = analyzeSeoProduct({ ...base, descChars:100, imagesNoAlt:2, tags:1, seoDescriptionQuality:"thin", geoReady:false });
  assert.equal(thin.seoScore, 68);
  assert.equal(thin.geoScore, 57);
  assert.ok(thin.issues.some((issue) => issue.includes("missing alt text")));
  const amazonTitles = extractMarketplaceTitles('<h2><a><span>All Mountain Snowboard for Beginners</span></a></h2>',"amazon");
  const ebayTitles = extractMarketplaceTitles('<div class="s-item__title"><span>Beginner All Mountain Snowboard</span></div>',"ebay");
  assert.deepEqual(amazonTitles,["All Mountain Snowboard for Beginners"]);
  assert.deepEqual(ebayTitles,["Beginner All Mountain Snowboard"]);
  const rankedKeywords = buildKeywordCandidates("snowboard",["beginner snowboard","all mountain snowboard"],[{source:"amazon",titles:amazonTitles},{source:"ebay",titles:ebayTitles}]);
  assert.ok(rankedKeywords.length>0);
  assert.ok(rankedKeywords.some(row=>row.keyword.includes("snowboard")&&row.sources.some(source=>source!=="shopify")));
  assert.ok(rankedKeywords.every((row,index)=>index===0||rankedKeywords[index-1].score>=row.score));
  assert.equal(containsUnsupportedClaims("A durable premium snowboard","Snowboard"),true);
  assert.equal(containsUnsupportedClaims("A durable snowboard","Durable construction confirmed by merchant"),false);
  assert.deepEqual(extractCatalogFacts({metafields:{nodes:[{namespace:"shopify",key:"color-pattern",definition:{name:"Color"},type:"list.metaobject_reference",value:"[]",references:{nodes:[{__typename:"TaxonomyValue",name:"Blue"}]}},{namespace:"custom",key:"binding_mount",definition:{name:"Snowboard binding mount"},type:"single_line_text_field",value:"Optimistic",jsonValue:"Optimistic"},{namespace:"private",key:"cost",value:"100"}]}}),[{label:"Color",value:"Blue",source:"category"},{label:"Snowboard binding mount",value:"Optimistic",source:"product"}]);
  const { forcedProposalTool, forcedSeoTool, selectedAgentToolNames } = await server.ssrLoadModule("/api/_agentChat.ts");
  const seoTurn = [{ role:"user", content:"Prepare an SEO approval for gid://shopify/Product/1" }];
  const selected = selectedAgentToolNames(seoTurn);
  assert.ok(selected.includes("get_products"));
  assert.ok(selected.includes("get_product_detail"));
  assert.ok(selected.includes("prepare_product_updates"));
  const seoWithMarketingHistory = selectedAgentToolNames([
    { role:"user", content:"Create a win-back campaign" },
    { role:"assistant", content:"I prepared a two-email win-back campaign." },
    { role:"user", content:"Audit my product SEO" },
  ], "seo");
  assert.ok(seoWithMarketingHistory.includes("get_product_detail"));
  assert.ok(!seoWithMarketingHistory.includes("create_winback_campaign"), "SEO workspace must not expose marketing campaign tools");
  assert.ok(!seoWithMarketingHistory.includes("create_recovery_campaign"), "SEO workspace must not expose recovery tools");
  assert.equal(forcedProposalTool(seoTurn), null, "SEO must fetch product detail before proposing an update");
  const approvalFollowup = [
    {role:"assistant",content:"Let's start with The Inventory Not Tracked Snowboard."},
    {role:"user",content:"oky please generate one I'll approve add that"},
  ];
  assert.equal(forcedSeoTool(approvalFollowup), "get_products", "SEO approval follow-up must begin live product resolution");
  assert.equal(forcedSeoTool([{role:"user",content:`Prepare SEO changes for ${base.id}`}]), "get_product_detail");
  assert.equal(forcedSeoTool([{role:"user",content:"Audit my catalog, but do not create changes yet."}]), null);
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
    if (String(url).endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow:");
    if (String(url).endsWith("/sitemap.xml")) return new Response("<urlset></urlset>");
    if (String(url).endsWith("/agents.md")) return new Response("# Demo store\nPublic catalog information for shopping agents and search systems.");
    if (String(url).includes("/products/incomplete")) return new Response(`<link rel="canonical" href="https://demo.myshopify.com/products/incomplete"><script type="application/ld+json">{"@type":"Product","name":"Incomplete","description":"Description","image":"image.jpg","brand":{"name":"Demo"},"sku":"SKU-1","offers":{"price":"10","priceCurrency":"USD","availability":"InStock"}}</script>`);
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await runSeoSnapshot("Bearer session", env);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.scanned, 1);
    assert.equal(snapshot.needsWork, 1);
    assert.equal(snapshot.technicalGeo.score,100);
    assert.equal(snapshot.products[0].title, "Incomplete");
    assert.ok(!snapshot.products[0].issues.includes("Missing search title"),"Shopify's default product title is the effective SEO title");
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
    if (target.includes("suggestqueries.google.com")) return Response.json(["canvas bag",["canvas tote bag","heavy canvas tote bag"]]);
    if (target.includes("amazon.com/s")) return new Response('<h2><a><span>Heavy Canvas Tote Bag</span></a></h2>');
    if (target.includes("ebay.com/sch")) return new Response('<div class="s-item__title"><span>Canvas Tote Bag</span></div>');
    if (target.includes("graphql.json")) {
      if (String(requestBody.query).includes("SeoOptimizerProduct")) return Response.json({data:{shop:{currencyCode:"USD",billingAddress:{countryCodeV2:"US"}},product:{id:base.id,title:"Canvas Bag",descriptionHtml:"<p>Heavy canvas tote.</p>",vendor:"Demo",productType:"Bag",category:{name:"Bags",fullName:"Bags"},tags:["canvas","bag"],seo:{title:null,description:null},options:[],media:{nodes:[]},variants:{nodes:[]}}}});
      if (String(requestBody.query).includes("SeoProduct")) return Response.json({data:{product:{id:base.id,title:"Canvas Bag",descriptionHtml:"<p>Heavy canvas tote.</p>",vendor:"Demo",productType:"Bag",tags:["canvas","bag"],seo:{title:null,description:null},media:{nodes:[]}}}});
      return Response.json({data:{nodes:[{id:base.id,updatedAt:"2026-08-11T00:00:00Z",title:"Canvas Bag",descriptionHtml:"<p>Heavy canvas tote.</p>",tags:["canvas","bag"],status:"ACTIVE",vendor:"Demo",productType:"Bag",seo:{title:null,description:null},media:{nodes:[]}}]}});
    }
    if (target.includes("shopify_actions") && method === "POST") return Response.json([{id:"action-1",kind:"product_update",status:"proposed",summary:"Improve Canvas Bag SEO",payload:requestBody.items?requestBody:{items:[{productId:base.id,seoTitle:"Canvas Bag | Demo",seoDescription:"Shop the Demo heavy canvas tote bag."}]},before_state:{products:[]},expires_at:"2026-08-12T00:00:00Z",created_at:"2026-08-11T00:00:00Z"}]);
    if (target.includes("action_events") || target.includes("store_events")) return new Response(null,{status:201});
    if (target.includes("api.groq.com")) {
      groqRound++;
      return Response.json({choices:[{message:{content:JSON.stringify({seoTitle:"Canvas Tote Bag | Demo",seoDescription:"Shop the Demo canvas tote bag with confirmed heavy canvas product details and review the available listing information online.",descriptionHtml:null,tags:["canvas bag","canvas tote bag"]})}}]});
    }
    throw new Error(`Unexpected chat fetch: ${target}`);
  };
  try {
    const chatResponse = await runAgentChat({manager:"seo",messages:[{role:"user",content:`Prepare an SEO approval for ${base.id}`} ]},"Bearer session","https://app.test",{...env,groqKey:"groq",groqModel:"test-model"});
    assert.equal(chatResponse.status,200);
    const stream = await chatResponse.text();
    assert.match(stream,/"action"/);
    assert.match(stream,/standalone SEO optimizer/);
    assert.equal(groqRound,1,"SEO proposal should use only one lightweight rendering call");
    const detailIndex = chatEvents.findIndex(event=>String(event.requestBody.query??"").includes("SeoOptimizerProduct"));
    const proposalIndex = chatEvents.findIndex(event=>event.target.includes("shopify_actions")&&event.method==="POST");
    assert.ok(detailIndex>=0&&proposalIndex>detailIndex,"chat must fetch exact product details before saving an SEO proposal");
  } finally { globalThis.fetch = originalFetch; }
  console.log("SEO manager scoring tests passed");
} finally {
  await server.close();
}
