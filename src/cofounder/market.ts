export const DEFAULT_USER_TARGET=10;
export const validUserCount=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export const validUserTarget=(n:unknown):n is number=>validUserCount(n)&&n>0;
export type UserCountRecord={count:number;asOf:number;source:string};
export type EarlyUser={id:string;name:string;status:'invited'|'tried';feedback:string;source:string;feedbackAt?:number};
function readUserCountRecord(value:unknown):UserCountRecord|undefined{
 const record=value as Partial<UserCountRecord>|null;
 return validUserCount(record?.count)&&typeof record?.asOf==='number'&&Number.isFinite(record.asOf)&&record.asOf>0&&record.asOf<=Date.now()&&typeof record.source==='string'&&!!record.source.trim()?record as UserCountRecord:undefined;
}
export type MarketEvidence={users:EarlyUser[];url:string;launchedAt?:number;userGoal?:number;totalUsers?:UserCountRecord};
export function readMarket(value:unknown):MarketEvidence{
 const data=value as Partial<MarketEvidence>|null;
 return {userGoal:validUserTarget(data?.userGoal)?data.userGoal:undefined,totalUsers:readUserCountRecord(data?.totalUsers),url:typeof data?.url==='string'?data.url:'',launchedAt:typeof data?.launchedAt==='number'&&Number.isFinite(data.launchedAt)?data.launchedAt:undefined,users:Array.isArray(data?.users)?data.users.filter(u=>u&&typeof u.id==='string'&&typeof u.name==='string'&&['invited','tried'].includes(u.status)&&typeof u.feedback==='string'&&typeof u.source==='string').map(u=>({...u,feedbackAt:typeof u.feedbackAt==='number'&&Number.isFinite(u.feedbackAt)?u.feedbackAt:undefined})):[]};
}
export function safeWebLink(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export function marketSnapshot(data:MarketEvidence){
 const namedTrials=data.users.filter(u=>u.status==='tried');
 const feedback=namedTrials.filter(u=>!!u.feedback.trim());
 const first=feedback.map(u=>u.feedbackAt).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n<=Date.now()&&!!data.launchedAt&&n>=data.launchedAt);
 const elapsed=safeWebLink(data.url)&&first.length&&data.launchedAt?Math.min(...first)-data.launchedAt:null;
 const recorded=readUserCountRecord(data.totalUsers);
 return {tried:Math.max(namedTrials.length,recorded?.count||0),namedTrials:namedTrials.length,userGoal:validUserTarget(data.userGoal)?data.userGoal:DEFAULT_USER_TARGET,feedback:feedback.length,quotes:feedback,elapsed,launched:!!safeWebLink(data.url)&&!!data.launchedAt&&data.launchedAt<=Date.now()};
}
export function feedbackDuration(ms:number|null){if(ms===null)return 'Not measured';if(ms<3600000)return '< 1 hour';if(ms<86400000)return Math.floor(ms/3600000)+'h';return Math.floor(ms/86400000)+'d '+Math.floor(ms%86400000/3600000)+'h';}

export function businessMilestones({planned,approved,launched,tried,feedback,userGoal}:{planned:boolean;approved:boolean;launched:boolean;tried:number;feedback:number;userGoal:number}){
 const existing=launched||tried>0||feedback>0;
 const target=validUserTarget(userGoal)?userGoal:DEFAULT_USER_TARGET;
 const stages=[
  {name:'Plan',note:planned?approved?'Approved':'Review':existing?'Not recorded':'Not started',done:planned&&approved},
  {name:'MVP',note:launched?'Launch logged':existing?'Not recorded':'Not live',done:launched},
  {name:'Users',note:tried.toLocaleString()+' / '+target.toLocaleString(),done:tried>=target},
  {name:'Feedback',note:feedback.toLocaleString()+' received',done:feedback>0},
 ];
 const current=existing?(tried<target?2:feedback===0?3:-1):(planned&&approved?1:0);
 return {stages,current};
}
