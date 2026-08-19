import { productManagerSnapshot } from "./_productManager";
import { shopifyEnvFromProcess } from "./_shopify";
export const config={runtime:"edge"};
export default async function handler(req:Request){if(req.method!=="GET")return new Response("Method not allowed",{status:405});return productManagerSnapshot(req.headers.get("authorization"),shopifyEnvFromProcess());}
