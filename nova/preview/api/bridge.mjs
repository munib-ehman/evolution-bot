const routes=new Map([
 ['/public/status','GET'],['/signup/checkout','POST'],['/webhooks/stripe','POST'],
 ['/webhooks/whatsapp','BOTH'],['/webhooks/sms','POST'],['/webhooks/call','POST'],
 ['/connections/google/callback','GET']
]);
export const config={api:{bodyParser:false}};
export async function forward(req,res,fetcher=fetch){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 const fail=(code,error)=>{res.statusCode=code;res.end(JSON.stringify({error}));};
 const url=new URL(req.url,'https://nova.invalid');
 const route='/'+String(req.query?.route || url.searchParams.get('route') || '').replace(/^\//,'');
 const allowed=routes.get(route);if(!allowed)return fail(404,'Unknown endpoint');
 if(allowed!==req.method && allowed!=='BOTH')return fail(405,'Method not allowed');
 if(!process.env.NOVA_BACKEND_URL){
  res.statusCode=route==='/public/status'?200:503;
  return res.end(JSON.stringify(route==='/public/status'?{checkout_ready:false,status:'setup_pending',message:'Pilot setup is in progress. Payment opens once Nova is ready.'}:{error:'Nova setup is in progress. No payment has been taken.'}));
 }
 try{
  const base=new URL(process.env.NOVA_BACKEND_URL);
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.pathname!=='/')return fail(503,'Backend connection needs configuration');
  if(base.hostname===req.headers.host)return fail(503,'Backend connection needs configuration');
  const target=new URL(route,base);for(const [key,value] of url.searchParams)if(key!=='route')target.searchParams.append(key,value);
  const headers={};for(const key of ['content-type','origin','stripe-signature','x-hub-signature-256','x-twilio-signature'])if(req.headers[key])headers[key]=req.headers[key];
  const chunks=[];let size=0;for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>1_000_000)return fail(413,'Request too large');chunks.push(Buffer.from(chunk));}
  const response=await fetcher(target,{method:req.method,headers,body:req.method==='POST'?Buffer.concat(chunks):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')||'application/json');
  res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){return fail(503,'Nova is temporarily unavailable. Please try later.');}
}
export default forward;
