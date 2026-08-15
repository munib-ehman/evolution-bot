import assert from "node:assert/strict";
import { createServer } from "vite";

const server=await createServer({server:{middlewareMode:true},appType:"custom",logLevel:"silent"});
try{
  const {listingScore,productManagerSnapshot}=await server.ssrLoadModule("/api/_productManager.ts");
  const complete={title:"Complete shopper title",descChars:350,images:4,imagesNoAlt:0,tags:5,vendor:true,productType:true};
  assert.equal(listingScore(complete),100);
  assert.ok(listingScore({...complete,descChars:0,images:0,tags:0,vendor:false,productType:false})<40);
  const {selectedAgentToolNames}=await server.ssrLoadModule("/api/_agentChat.ts");
  const tools=selectedAgentToolNames([{role:"user",content:"Improve my weakest product listing and recommend a collection"}],"product");
  assert.ok(tools.includes("get_products"));
  assert.ok(tools.includes("get_product_sales"));
  assert.ok(tools.includes("get_abandoned_checkouts"));
  assert.ok(!tools.includes("prepare_collection"),"a recommendation request must not expose a write proposal tool");
  assert.ok(!tools.includes("create_recovery_campaign"));
  const proposalTools=selectedAgentToolNames([{role:"user",content:"Prepare a collection update for my store"}],"product");
  assert.ok(proposalTools.includes("prepare_collection"),"an explicit preparation request should expose the matching proposal tool");
  const {repairProductManagerUpdateArgs,hasConfirmedProductFacts,pausedListingState,extractPseudoToolCalls}=await server.ssrLoadModule("/api/_agentChat.ts");
  const repaired=repairProductManagerUpdateArgs({items:[{productId:"The Multi-location Snowboard",descriptionHtml:"<p>Confirmed carbon-fiber construction.</p>"}]},[{id:"gid://shopify/Product/42",title:"The Multi-location Snowboard"}],"Paused listing: The Multi-location Snowboard");
  assert.equal(repaired.items[0].productId,"gid://shopify/Product/42","resumed listing jobs must bind the live Shopify product ID server-side");
  assert.equal(hasConfirmedProductFacts("what exactly do you want to know?"),false,"a clarification question must never trigger a proposal");
  assert.equal(hasConfirmedProductFacts("It is made from carbon fiber, has layered protection and shoe clips, is mainly for intermediate riders, and includes three covers, a cleaning kit, and bottom glaze for use on snow."),true,"a substantive merchant fact reply must resume the listing job");
  const resumed=pausedListingState([
    {role:"assistant",content:"I've paused the listing job for The Multi-location Snowboard."},
    {role:"user",content:"It is made from carbon fiber with good grip and layered protection."},
    {role:"assistant",content:"The writer could not finish."},
    {role:"user",content:"It is for intermediate adult riders and includes covers, clips, a cleaning kit, and glaze. Keep it away from prolonged sunlight."},
    {role:"assistant",content:"Tell me the facts again."},
    {role:"user",content:"what the hell"},
  ]);
  assert.ok(resumed&&hasConfirmedProductFacts(resumed.facts),"facts across follow-ups must be merged after a paused listing job");
  assert.ok(!resumed.facts.includes("what the hell"),"frustration must not be treated as product facts or proposal intent");
  const pseudo=extractPseudoToolCalls('I will check. <function=get_abandoned_checkouts>{"days":30}</function>',["get_abandoned_checkouts"]);
  assert.equal(pseudo.calls[0].function.name,"get_abandoned_checkouts","pseudo tool markup should be recovered as a real read-only tool call");
  assert.equal(pseudo.text,"I will check.");
  const {catalogAnchors,reportFitsCatalog}=await server.ssrLoadModule("/api/_productHunt.ts");
  const snowboardDigest={host:"demo.myshopify.com",storeTitle:"Demo",storeDescription:"",priceBand:null,productTitles:["The Multi-location Snowboard","The Draft Snowboard","The Videographer Snowboard","Gift Card"]};
  assert.deepEqual(catalogAnchors(snowboardDigest.productTitles).slice(0,1),["snowboard"]);
  const unrelated={storeUrl:"https://demo.myshopify.com",niche:"popular products",audience:"online shoppers",summary:"",generatedAt:new Date().toISOString(),products:[{name:"Reusable Silicone Food Storage Bags",hook:"Kitchen storage",whyWinning:"Popular kitchen item",stats:[],sourcing:[],listing:{title:"Bags",price:"CA $22.99",bullets:[],description:""},fit:"Fits ecommerce stores",sources:[]}]};
  assert.equal(reportFitsCatalog(unrelated,snowboardDigest),false,"unrelated generic products must never pass a snowboard catalog-fit gate");
  const related={...unrelated,niche:"snowboard equipment",products:[{...unrelated.products[0],name:"Snowboard Edge Tuning Tool",hook:"Maintain snowboard edges",fit:"A maintenance add-on for a snowboard store"}]};
  assert.equal(reportFitsCatalog(related,snowboardDigest),true,"adjacent products explicitly tied to the dominant snowboard niche should pass");

  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const target=String(url),body=init.body?JSON.parse(init.body):{};
    if(target.endsWith("/auth/v1/user"))return Response.json({id:"user-1",email:"owner@example.com"});
    if(target.includes("profiles"))return Response.json([{plan:"operator"}]);
    if(target.includes("shopify_connections"))return Response.json([{shop_domain:"demo.myshopify.com",access_token:"token",scopes:"write_products,read_orders,read_checkouts"}]);
    if(target.includes("graphql.json")){
      const query=String(body.query??"");
      if(query.includes("ProductAudit"))return Response.json({data:{products:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{id:"gid://shopify/Product/1",title:"Thin Product",status:"ACTIVE",createdAt:"2025-01-01T00:00:00Z",descriptionHtml:"",tags:[],handle:"thin",vendor:"",productType:"",seo:{title:null,description:null},mediaCount:{count:0},media:{nodes:[]},variants:{nodes:[{price:"20",inventoryQuantity:5,inventoryPolicy:"DENY",inventoryItem:{tracked:true}}]}}]}}});
      if(query.includes("OrdersWindow"))return Response.json({data:{orders:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[]}}});
      if(query.includes("AbandonedCheckoutsWindow"))return Response.json({data:{abandonedCheckouts:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[]}}});
      if(query.includes("ProductManagerCollections"))return Response.json({data:{collections:{nodes:[]}}});
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  try{
    const response=await productManagerSnapshot("Bearer session",{supabaseUrl:"https://supabase.test",serviceRoleKey:"service",adminEmails:"owner@example.com"});
    assert.equal(response.status,200);
    const snapshot=await response.json();
    assert.equal(snapshot.scanned,1);
    assert.equal(snapshot.products[0].recommendation,"improve");
    assert.equal(snapshot.products[0].archiveEligible,true);
    assert.equal(snapshot.signals.pageViews,false);
  }finally{globalThis.fetch=originalFetch;}
  console.log("Product Manager tests passed");
}finally{await server.close();}
