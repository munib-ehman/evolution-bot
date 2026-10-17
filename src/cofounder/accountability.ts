import type {Message} from '../types';
export type WorkEvent={id:string;kind:'plan'|'approval'|'reply'|'draft';actor:'you'|'evo';state:'working'|'saved'|'failed'|'stopped';at:number;title:string;message?:string};
export function recoverEvents(events:WorkEvent[]=[]):WorkEvent[]{
 return events.map(e=>e.state==='working'?{...e,state:'stopped',title:'Interrupted before completion'}:e);
}
export function progressSnapshot(work:{idea:string;draft?:string;plan:string;approved:boolean;events?:WorkEvent[]}){
 return {
  idea:!!(work.idea||work.draft?.trim()),
  plan:!!work.plan,
  output:!!work.approved&&(work.events||[]).some(e=>e.kind==='reply'&&e.state==='saved'&&!!e.message),
  decisions:(work.events||[]).filter(e=>e.kind==='approval'&&e.state==='saved'),
  outputs:(work.events||[]).filter(e=>e.actor==='evo'&&e.state==='saved'&&!!e.message),
 };
}

export function recoverConversation(messages:Message[]=[]):Message[]{
 return messages.map(m=>m.pending?{...m,pending:false,content:m.content?m.content+'\n\n_Interrupted before completion._':'Interrupted before completion.'}:m);
}

// A conversation is evidence of discussion, never evidence of a built product.
export function mvpJourney(work:{idea:string;draft?:string;plan:string;approved:boolean;events?:WorkEvent[];conversation?:Message[]}){
 const idea=!!(work.idea.trim()||work.draft?.trim());
 const plan=idea&&!!work.plan.trim();
 const approved=plan&&work.approved;
 const draft=approved&&(work.events||[]).some(e=>e.kind==='draft'&&e.state==='saved'&&(work.conversation||[]).some(m=>m.id===e.message&&m.role==='assistant'&&!m.pending&&!!m.content.trim()));
 const completed=[idea,plan,approved,draft,false];
 const labels=['Idea','Plan','Approve','Draft','Build'];
 const count=completed.filter(Boolean).length;
 const tasks=[
  {title:'Save your product idea',owner:'You',action:'Add idea',detail:'A sentence is enough to begin.'},
  {title:'Define the first version',owner:'Evo',action:'Plan my MVP',detail:'A small scope, ready for your decision.'},
  {title:'Review the MVP plan',owner:'You',action:'Review plan',detail:'Take your time. Work starts with your approval.'},
  {title:'Prepare the first draft',owner:'Evo',action:'Prepare draft',detail:'Within the scope you approved.'},
  {title:'Review the draft before building',owner:'You',action:'Review draft',detail:'The draft is saved. Building needs a coding connection.'},
 ];
 return {steps:labels.map((label,i)=>({label,done:completed[i],current:i===count})),count,task:tasks[count]};
}
