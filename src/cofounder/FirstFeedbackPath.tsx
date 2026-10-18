import {EvoIcon} from './Icons';
import {EARLY_USER_TARGET} from './market';
export function FirstFeedbackPath({planned,approved,launched,tried,feedback,onProduct,onPeople}:{planned:boolean;approved:boolean;launched:boolean;tried:number;feedback:number;onProduct:()=>void;onPeople:()=>void}){
 const stages=[
  {name:'Plan',note:planned?approved?'Approved':'Review':'Not started',done:planned&&approved,action:onProduct},
  {name:'MVP',note:launched?'Launch logged':'Not live',done:launched,action:onProduct},
  {name:'Users',note:tried+' / '+EARLY_USER_TARGET,done:tried>=EARLY_USER_TARGET,action:onPeople},
  {name:'Feedback',note:feedback+' received',done:feedback>0,action:onPeople},
 ];
 const current=stages.findIndex(s=>!s.done);
 return <ol className="evo-milestones" aria-label="Milestones to your first customer feedback">{stages.map((stage,i)=><li key={stage.name} className={stage.done?'is-done':current===i?'is-current':''}><button onClick={stage.action} aria-current={current===i?'step':undefined} aria-label={stage.name+': '+stage.note+(stage.name==='Users'?' people who tried your product':'')}><span className="evo-milestone-dot">{stage.done?<EvoIcon name="check" size={12}/>:i+1}</span><strong>{stage.name}</strong><small className={stage.name==='Users'?'evo-user-goal':''}>{stage.note}</small></button></li>)}</ol>;
}
