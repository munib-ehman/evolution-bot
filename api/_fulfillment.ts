import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import { getConnection, SHOPIFY_API_VERSION, type ShopifyEnv } from "./_shopify";

const json=(status:number,body:Record<string,unknown>)=>({status,body});
const emailSafe=(value:unknown,max:number)=>(typeof value==="string"?value.trim().slice(0,max):"");

export async function runCreateFulfillment(body:Record<string,unknown>,authHeader:string|null,env:ShopifyEnv){
  const user=await resolveUserFull(env,authHeader); if(!user)return json(401,{error:"Sign in first."});
  if(!(await isOperator(env,user.id,user.email)))return OPERATOR_REQUIRED;
  const conn=await getConnection(env,user.id); if(!conn)return json(409,{error:"Connect Shopify first."});
  const granted=new Set((conn.scopes??"").split(",").map(scope=>scope.trim()));
  const required=["read_merchant_managed_fulfillment_orders","write_merchant_managed_fulfillment_orders"];
  if(required.some(scope=>!granted.has(scope)))return json(409,{error:"Evolution needs Shopify fulfillment access. Approve the one-time Shopify permission update, then retry.",reconnectRequired:true});
  const orderId=emailSafe(body.orderId,180); const trackingNumber=emailSafe(body.trackingNumber,120); const carrier=emailSafe(body.carrier,80);
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId))return json(400,{error:"A valid Shopify order is required."});
  const request=async(query:string,variables:Record<string,unknown>)=>{
    const response=await fetch(`https://${conn.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,{method:"POST",headers:{"X-Shopify-Access-Token":conn.access_token,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(12_000)});
    return response.json() as Promise<Record<string,any>>;
  };
  const order=await request(`query FulfillmentWork($id:ID!){order(id:$id){id name fulfillmentOrders(first:20){nodes{id status requestStatus supportedActions{action}}}}}`,{id:orderId});
  const queryErrors=(order.errors??[]) as {message?:string}[]; if(queryErrors.length)return json(502,{error:queryErrors.map(item=>item.message).filter(Boolean).join("; ")||"Shopify could not read fulfillment work."});
  const nodes=(order.data?.order?.fulfillmentOrders?.nodes??[]) as {id:string;status:string;supportedActions?:{action?:string}[]}[];
  const ready=nodes.filter(node=>["OPEN","IN_PROGRESS"].includes(node.status)&&(!node.supportedActions?.length||node.supportedActions.some(item=>item.action==="CREATE_FULFILLMENT")));
  if(!ready.length){const states=nodes.map(node=>node.status).join(", ");return json(409,{error:nodes.length?`Shopify currently has this fulfillment work in ${states} state. Evolution will enable fulfillment when Shopify marks it ready.`:"Shopify returned no fulfillment work for this order. Evolution cannot create a fulfillment until Shopify routes the order to a location."});}
  const fulfillment={notifyCustomer:false,lineItemsByFulfillmentOrder:ready.map(node=>({fulfillmentOrderId:node.id})),...(trackingNumber?{trackingInfo:{number:trackingNumber,...(carrier?{company:carrier}:{})}}:{})};
  const created=await request(`mutation CreateFulfillment($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id status trackingInfo{company number url}} userErrors{field message}}}`,{fulfillment});
  const payload=created.data?.fulfillmentCreate; const errors=[...(created.errors??[]).map((item:{message?:string})=>item.message),...(payload?.userErrors??[]).map((item:{message?:string})=>item.message)].filter(Boolean);
  if(!payload?.fulfillment?.id||errors.length)return json(502,{error:errors.join("; ")||"Shopify could not create the fulfillment."});
  return json(200,{fulfilled:true,orderId,fulfillment:payload.fulfillment,customerNotified:false});
}
