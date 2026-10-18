export type EarlyUser={id:string;name:string;status:'invited'|'tried';feedback:string;source:string;feedbackAt?:number};
export type MarketEvidence={users:EarlyUser[];url:string;launchedAt?:number};
export function readMarket(value:unknown):MarketEvidence{
 const data=value as Partial<MarketEvidence>|null;
 return {url:typeof data?.url==='string'?data.url:'',launchedAt:typeof data?.launchedAt==='number'&&Number.isFinite(data.launchedAt)?data.launchedAt:undefined,users:Array.isArray(data?.users)?data.users.filter(u=>u&&typeof u.id==='string'&&typeof u.name==='string'&&['invited','tried'].includes(u.status)&&typeof u.feedback==='string'&&typeof u.source==='string').map(u=>({...u,feedbackAt:typeof u.feedbackAt==='number'&&Number.isFinite(u.feedbackAt)?u.feedbackAt:undefined})):[]};
}
export function safeWebLink(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export function marketSnapshot(data:MarketEvidence){
 const tried=data.users.filter(u=>u.status==='tried');
 const feedback=tried.filter(u=>!!u.feedback.trim());
 const first=feedback.map(u=>u.feedbackAt).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n<=Date.now()&&!!data.launchedAt&&n>=data.launchedAt);
 const elapsed=safeWebLink(data.url)&&first.length&&data.launchedAt?Math.min(...first)-data.launchedAt:null;
 return {tried:tried.length,feedback:feedback.length,quotes:feedback,elapsed,launched:!!safeWebLink(data.url)&&!!data.launchedAt&&data.launchedAt<=Date.now()};
}
export function feedbackDuration(ms:number|null){if(ms===null)return 'Not measured';if(ms<3600000)return '< 1 hour';if(ms<86400000)return Math.floor(ms/3600000)+'h';return Math.floor(ms/86400000)+'d '+Math.floor(ms%86400000/3600000)+'h';}
