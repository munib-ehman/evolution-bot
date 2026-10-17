import type {Message} from '../types';
export type WorkEvent={id:string;kind:'plan'|'approval'|'reply';actor:'you'|'evo';state:'working'|'saved'|'failed'|'stopped';at:number;title:string;message?:string};
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
