import assert from "node:assert/strict";
import { createServer } from "vite";

const server=await createServer({server:{middlewareMode:true},appType:"custom",logLevel:"silent"});
try{
  const {productManagerArchive,productManagerOptimize}=await server.ssrLoadModule("/api/_productManager.ts");
  const {runActionPropose}=await server.ssrLoadModule("/api/_actions.ts");
  const env={supabaseUrl:"https://supabase.test",serviceRoleKey:"service",adminEmails:"owner@example.com",groqKey:"groq",shopifyApiKey:"key",shopifyApiSecret:"secret"};
  const productId="gid://shopify/Product/101",mediaId="gid://shopify/MediaImage/201";
  const originalFetch=globalThis.fetch;

  function installScenario({units=0,abandoned=0}={}){
    const calls=[];
    globalThis.fetch=async(url,init={})=>{
      const target=String(url),method=init.method??"GET",body=init.body?JSON.parse(init.body):{};calls.push({target,method,body});
      if(target.endsWith("/auth/v1/user"))return Response.json({id:"user-1",email:"owner@example.com"});
      if(target.includes("/profiles"))return Response.json([{plan:"operator"}]);
      if(target.includes("shopify_connections"))return Response.json([{shop_domain:"demo.myshopify.com",access_token:"token",scopes:"write_products,write_files,read_orders,read_checkouts"}]);
      if(target.includes("api.groq.com"))return Response.json({choices:[{message:{content:JSON.stringify({title:"Canvas Carry Tote",descriptionHtml:"<p>The Canvas Carry Tote by Demo is a straightforward tote designed around the verified Black color option and the product information already maintained in Shopify. Its clear construction-focused presentation helps shoppers understand the available configuration without unsupported promises.</p><h3>Product details</h3><ul><li>Canvas tote construction recorded by the merchant</li><li>Black color option available in Shopify</li><li>Demo vendor attribution preserved</li><li>Existing canvas and tote catalog classification retained</li></ul><h3>What’s included</h3><p>One Canvas Carry Tote in the selected Shopify configuration. Review the live product options, price, availability, and product media before ordering. The concise structure makes the known details easy to scan while leaving room for the merchant to add measurements, capacity, handle construction, closure details, and care instructions when those facts are confirmed.</p><p>Use and care should follow the merchant’s confirmed instructions when those details are added to the catalog. No unverified performance, material treatment, sizing, or care claims have been introduced into this listing.</p>",tags:["canvas","tote","black"],rationale:"Turns verified catalog facts into a structured, shopper-readable listing while preserving factual limits."})}}]});
      if(target.includes("suggestqueries.google.com"))return Response.json(["canvas tote",["canvas tote bag","canvas carry tote"]]);
      if(target.includes("amazon.com/s?k="))return new Response('<h2><a><span>Canvas Tote Bag for Everyday Carry</span></a></h2>',{headers:{"Content-Type":"text/html"}});
      if(target.includes("ebay.com/sch/i.html"))return new Response('<div class="s-item__title">Canvas Carry Tote Bag</div>',{headers:{"Content-Type":"text/html"}});
      if(target.includes("graphql.json")){
        const query=String(body.query??"");
        if(query.includes("ProductAudit"))return Response.json({data:{products:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[{id:productId,title:"Canvas Tote",status:"ACTIVE",createdAt:"2025-01-01T00:00:00Z",descriptionHtml:"<p>Canvas tote by Demo. Available in Black.</p>",tags:["canvas","tote"],handle:"canvas-tote",vendor:"Demo",productType:"Tote",seo:{title:"Canvas Tote SEO",description:"Existing meta description"},mediaCount:{count:1},media:{nodes:[{alt:""}]},variants:{nodes:[{price:"30",inventoryQuantity:4,inventoryPolicy:"DENY",inventoryItem:{tracked:true}}]}}]}}});
        if(query.includes("OrdersWindow"))return Response.json({data:{orders:{pageInfo:{hasNextPage:false,endCursor:null},nodes:units?[{createdAt:"2026-08-01T00:00:00Z",currentTotalPriceSet:{shopMoney:{amount:"30"}},customer:{id:"gid://shopify/Customer/1"},lineItems:{nodes:[{title:"Canvas Tote",quantity:units,originalUnitPriceSet:{shopMoney:{amount:"30"}}}]}}]:[]}}});
        if(query.includes("AbandonedCheckoutsWindow"))return Response.json({data:{abandonedCheckouts:{pageInfo:{hasNextPage:false,endCursor:null},nodes:abandoned?[{createdAt:"2026-08-10T00:00:00Z",totalPriceSet:{shopMoney:{amount:"30"}},lineItemsQuantity:abandoned,customer:{email:null},lineItems:{nodes:[{title:"Canvas Tote",quantity:abandoned}]}}]:[]}}});
        if(query.includes("ProductManagerListing"))return Response.json({data:{product:{id:productId,title:"Canvas Tote",descriptionHtml:"<p>Canvas tote by Demo. Available in Black.</p>",vendor:"Demo",productType:"Tote",tags:["canvas","tote"],options:[{name:"Color",values:["Black"]}],media:{nodes:[{id:mediaId,alt:""}]}}}});
        if(query.includes("ActionProducts"))return Response.json({data:{nodes:[{id:productId,updatedAt:"2026-08-15T00:00:00Z",title:"Canvas Tote",descriptionHtml:"<p>Canvas tote by Demo.</p>",tags:["canvas","tote"],status:"ACTIVE",vendor:"Demo",productType:"Tote",seo:{title:"Canvas Tote SEO",description:"Existing meta description"},media:{nodes:[{id:mediaId,alt:null}]}}]}});
      }
      if(target.includes("shopify_actions")&&method==="POST"){
        return Response.json([{id:"action-1",user_id:"user-1",shop_domain:"demo.myshopify.com",kind:body.kind,status:"proposed",summary:body.summary,payload:body.payload,before_state:body.before_state,expires_at:"2026-08-16T00:00:00Z",created_at:"2026-08-15T00:00:00Z"}]);
      }
      if(target.includes("shopify_action_events"))return new Response(null,{status:201});
      throw new Error(`Unexpected fetch: ${target}`);
    };
    return calls;
  }

  try{
    let calls=installScenario();
    const optimized=await productManagerOptimize({productId},"Bearer session",env);
    assert.equal(optimized.status,201);
    const optimizedBody=await optimized.json();
    const item=optimizedBody.action.payload.items[0];
    assert.equal(item.title,"Canvas Carry Tote");
    assert.equal(item.seoTitle,undefined,"Product Manager must not write SEO title");
    assert.equal(item.seoDescription,undefined,"Product Manager must not write meta description");
    assert.ok(optimizedBody.action.payload.evidence.listingVa,"Product Manager must store dedicated listing-VA evidence");
    assert.ok(optimizedBody.action.payload.evidence.keywords.length,"Product Manager must include researched listing phrases");
    assert.ok(item.tags.includes("canvas")&&item.tags.includes("tote"),"Product Manager must preserve existing catalog tags");
    assert.deepEqual(item.mediaAlt,[{id:mediaId,alt:"Canvas Tote"}]);
    assert.ok(calls.some(call=>call.target.includes("shopify_actions")),"optimization must persist an approval proposal");

    calls=installScenario();
    const eligible=await productManagerArchive({productId,title:"Canvas Tote"},"Bearer session",env);
    assert.equal(eligible.status,201);
    const eligibleBody=await eligible.json();
    assert.equal(eligibleBody.action.kind,"product_status_update");
    assert.equal(eligibleBody.action.payload.items[0].status,"ARCHIVED");
    assert.ok(!calls.some(call=>String(call.body.query??"").includes("productUpdate")),"preparing archive must not mutate Shopify");

    installScenario({units:1});
    const sold=await productManagerArchive({productId,title:"Canvas Tote"},"Bearer session",env);
    assert.equal(sold.status,409);
    assert.match((await sold.json()).error,/no longer meets the archive safety rule/i);

    installScenario({abandoned:1});
    const carted=await productManagerArchive({productId,title:"Canvas Tote"},"Bearer session",env);
    assert.equal(carted.status,409);

    installScenario();
    const draft=await runActionPropose({kind:"product_draft_create",summary:"Launch-ready draft",product:{title:"New Tote",descriptionHtml:"<p>Verified description.</p>",price:49.95,tags:["tote"]},evidence:{research:{market:"Canada",sources:[{title:"Trend source",url:"https://example.com/trend"}]}}},"Bearer session",env);
    assert.equal(draft.status,201);
    const draftBody=await draft.json();
    assert.equal(draftBody.action.payload.product.price,49.95);
    assert.equal(draftBody.action.payload.evidence.research.market,"Canada");
    console.log("Product Manager endpoint E2E tests passed");
  }finally{globalThis.fetch=originalFetch;}
}finally{await server.close();}
