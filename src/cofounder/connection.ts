/** The real chat proxy returns 204 when configured. A static SPA fallback returns HTML/200. */
export async function checkAIConnection(signal?:AbortSignal):Promise<boolean>{
 try{
  const response=await fetch('/api/chat',{method:'GET',cache:'no-store',signal});
  return response.status===204;
 }catch{return false;}
}
