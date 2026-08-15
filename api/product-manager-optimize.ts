import { productManagerOptimize } from "./_productManager";
import { shopifyEnvFromProcess } from "./_shopify";
export const config={runtime:"edge"};
export default async function handler(req:Request){if(req.method!=="POST")return new Response("Method not allowed",{status:405});let body:{productId?:unknown;confirmedFacts?:unknown}={};try{body=await req.json() as typeof body;}catch{return Response.json({error:"Invalid request body."},{status:400});}return productManagerOptimize(body,req.headers.get("authorization"),shopifyEnvFromProcess());}
