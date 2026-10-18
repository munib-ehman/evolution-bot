import {EvoIcon} from './Icons';
export function FirstFeedbackPath({idea,launched,tried,feedback,draftReady,onProduct,onPeople}:{idea:boolean;launched:boolean;tried:number;feedback:number;draftReady:boolean;onProduct:()=>void;onPeople:()=>void}){
 const stages=[
  {name:'Your product',note:launched?'Launch recorded':draftReady?'Draft ready':idea?'Idea saved':'Start here',icon:'engineering' as const,done:launched,action:onProduct},
  {name:'First users',note:tried?tried+' tried it':'No trials recorded',icon:'person' as const,done:tried>0,action:onPeople},
  {name:'Real feedback',note:feedback?feedback+(feedback===1?' response':' responses'):'No feedback yet',icon:'feedback' as const,done:feedback>0,action:onPeople},
 ];
 const current=stages.findIndex(s=>!s.done);
 return <div className="evo-signal-map" aria-label="Your path to first customer feedback">
  <svg className="evo-signal-line" viewBox="0 0 600 120" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M80 70C150 70 140 35 225 35S330 90 410 70 475 45 520 70" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 6"/><path d="m515 63 7 7-9 4" stroke="currentColor" strokeWidth="1.5"/></svg>
  {stages.map((stage,i)=><button className={'evo-signal-stop '+(stage.done?'is-done':current===i?'is-current':'')} key={stage.name} onClick={stage.action} aria-label={stage.name+': '+stage.note}><span className="evo-stop-number">0{i+1}</span><span className="evo-stop-object">{stage.icon==='feedback'?<svg width="29" height="29" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M25 5H7a4 4 0 0 0-4 4v12a4 4 0 0 0 4 4h4l5 5 5-5h4a4 4 0 0 0 4-4V9a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.3"/><path d="M10 13h12m-12 5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>:<EvoIcon name={stage.icon} size={28}/>}<i>{stage.done?<EvoIcon name="check" size={10}/>:current===i?<span/>:null}</i></span><strong>{stage.name}</strong><small>{stage.note}</small></button>)}
 </div>;
}
