import { runCreateFulfillment } from "./_fulfillment";
import { shopifyEnvFromProcess } from "./_shopify";
export const config={runtime:"edge"};
export default async function handler(req:Request){if(req.method!=="POST")return new Response("Method not allowed",{status:405});const body=await req.json().catch(()=>({})) as Record<string,unknown>;const result=await runCreateFulfillment(body,req.headers.get("authorization"),shopifyEnvFromProcess());return Response.json(result.body,{status:result.status,headers:{"Cache-Control":"no-store"}});}
