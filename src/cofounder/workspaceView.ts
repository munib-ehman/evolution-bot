// Local presentation helpers. These suggestions do not imply an AI task ran.
export function suggestedOutcome(idea:string){
 let product=idea.trim().replace(/\s+/g,' ').replace(/[.!]+$/,'');
 product=product.replace(/^(?:i\s+(?:want|need)(?:\s+to\s+(?:build|create|launch|make))?|i(?:'m| am)\s+(?:building|creating)|(?:build|create|make))\s+/i,'');
 if(!product||product.length>150||/[?\n]/.test(product)||/^(?:hi|hello|hey|how|why|what|can you|help me)\b/i.test(product))return 'Launch a first version and get real feedback';
 product=product.replace(/\bai[ -]native\b/gi,'AI-native').replace(/\bai\b/gi,'AI').replace(/^(A|An|The)\b/,v=>v.toLowerCase());
 return 'Launch '+product;
}
import {DEFAULT_USER_TARGET} from './market';
export type TaskAction='idea'|'start'|'plan'|'record'|'people'|'connection'|'stop'|'none';
export function currentWorkspaceTask({step,connected,busy,activeKind,launched,tried,feedback,userGoal=DEFAULT_USER_TARGET}:{step:number;connected:boolean|null;busy:boolean;activeKind?:string;launched:boolean;tried:number;feedback:number;userGoal?:number}):{state:string;title:string;action:string;target:TaskAction}{
 if(busy)return {state:'In progress',title:activeKind==='plan'?'Preparing the MVP plan':activeKind==='draft'?'Preparing the first draft':'Working on your message',action:'Stop',target:'stop'};
 if(launched||tried>0||feedback>0){
  if(tried>=userGoal&&feedback>0)return {state:'Goal reached',title:'Choose your next milestone',action:'Set goal',target:'people'};
  return feedback?{state:'For review',title:'Customer feedback is ready',action:'Review',target:'people'}:tried?{state:'Ready',title:'Hear from the people who tried it',action:'View users',target:'people'}:{state:'Ready',title:'Find your first product testers',action:'View users',target:'people'};
 }
 if(step===0)return {state:'Not started',title:'Tell Evo what you want to build',action:'Add idea',target:'idea'};
 if(step===2)return {state:'Your decision',title:'Review the MVP scope',action:'Review',target:'plan'};
 if(step===4)return {state:'For review',title:'Your first draft is ready',action:'Review',target:'record'};
 if(connected===null)return {state:'Checking',title:'Checking the AI connection',action:'',target:'none'};
 if(!connected)return {state:'Not started',title:'No task running',action:'',target:'connection'};
 return {state:'Ready',title:step===1?'Prepare the MVP plan':'Prepare the first draft',action:'Start',target:'start'};
}
