import {EvoIcon} from './Icons';
import {businessMilestones} from './market';
export function FirstFeedbackPath({planned,approved,launched,tried,feedback,userGoal,onProduct,onPeople}:{planned:boolean;approved:boolean;launched:boolean;tried:number;feedback:number;userGoal:number;onProduct:()=>void;onPeople:()=>void}){
 const {stages,current}=businessMilestones({planned,approved,launched,tried,feedback,userGoal});
 return <ol className="evo-milestones" aria-label="Business progress toward your current goal">{stages.map((stage,i)=><li key={stage.name} className={stage.done?'is-done':current===i?'is-current':''}><button onClick={i<2?onProduct:onPeople} aria-current={current===i?'step':undefined} aria-label={stage.name+': '+stage.note+(stage.name==='Users'?' people who tried your product. Edit target and current count':'')}><span className="evo-milestone-dot">{stage.done?<EvoIcon name="check" size={12}/>:i+1}</span><strong>{stage.name}</strong><small className={stage.name==='Users'?'evo-user-goal':''}>{stage.note}{stage.name==='Users'&&<EvoIcon name="chevron" size={10}/>}</small></button></li>)}</ol>;
}
