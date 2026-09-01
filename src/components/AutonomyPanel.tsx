import { useEffect,useState } from "react";
import { fetchActionHistory,type ShopifyActionProposal } from "../lib/actions";
import { getAutonomy,saveAutonomy,type AutonomyContract,type DailyPace } from "../lib/autonomy";
import { getMarketingStatus,type MarketingActivity } from "../lib/marketingDecisions";
import { recoveryCampaignAction } from "../lib/recoveryCampaigns";
import { winbackCampaignAction } from "../lib/winbackCampaigns";
import { reviewCampaignAction } from "../lib/reviewCampaigns";
import { broadcastCampaignAction } from "../lib/broadcastCampaigns";
import { getSupportCases,type SupportCase,type SupportOwner } from "../lib/supportCases";
import { ActionCard } from "./ActionCard";

type InboxTab="approvals"|"working"|"completed";
type SupportApproval={role:SupportOwner;item:SupportCase};
const paceCopy:Record<DailyPace,string>={light:"2 prepared changes a day",balanced:"5 prepared changes a day",active:"10 prepared changes a day"};
const money=(value:number|null)=>value==null?"Not enough evidence":new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(value);
const activityCopy=(activity:MarketingActivity)=>{
  const variant=activity.marketing_activity_variants?.find(item=>!item.is_holdout&&item.subject&&item.body);
  if(variant)return{subject:variant.subject,body:variant.body};
  const strategy=activity.strategy as{copy?:{subject?:string;body?:string};touch?:{subject?:string;body?:string}};
  const copy=strategy.copy??strategy.touch;
  return copy?.subject&&copy.body?{subject:copy.subject,body:copy.body}:null;
};

export function AutonomyPanel({open,onClose,onOpenSupport}:{open:boolean;onClose:()=>void;onOpenSupport:(role:SupportOwner,orderId:string)=>void}){
  const [contract,setContract]=useState<AutonomyContract|null>(null),[watching,setWatching]=useState<string[]>([]),[actions,setActions]=useState<ShopifyActionProposal[]>([]),[activities,setActivities]=useState<MarketingActivity[]>([]),[supportApprovals,setSupportApprovals]=useState<SupportApproval[]>([]);
  const [tab,setTab]=useState<InboxTab>("approvals"),[busy,setBusy]=useState(false),[campaignBusy,setCampaignBusy]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false);

  const load=async(showBusy=true)=>{
    if(showBusy)setBusy(true);
    setError(null);
    const [autonomyResult,actionsResult,marketingResult,customerSupportResult,operationsSupportResult]=await Promise.allSettled([
      getAutonomy(),fetchActionHistory(),getMarketingStatus(),getSupportCases("customer-success"),getSupportCases("operations"),
    ]);
    if(autonomyResult.status==="fulfilled"){setContract(autonomyResult.value.contract);setWatching(autonomyResult.value.watching);}
    if(actionsResult.status==="fulfilled")setActions(actionsResult.value);
    if(marketingResult.status==="fulfilled")setActivities(marketingResult.value.activities);
    const support:SupportApproval[]=[];
    if(customerSupportResult.status==="fulfilled")support.push(...customerSupportResult.value.filter(item=>item.notification?.status==="proposed"||item.notification?.status==="failed").map(item=>({role:"customer-success" as const,item})));
    if(operationsSupportResult.status==="fulfilled")support.push(...operationsSupportResult.value.filter(item=>item.notification?.status==="proposed"||item.notification?.status==="failed").map(item=>({role:"operations" as const,item})));
    setSupportApprovals(support);
    const fatal=[autonomyResult,actionsResult].find(result=>result.status==="rejected");
    if(fatal?.status==="rejected")setError(fatal.reason instanceof Error?fatal.reason.message:"Could not load the Autopilot inbox.");
    if(showBusy)setBusy(false);
  };
  useEffect(()=>{if(open)void load();},[open]);
  useEffect(()=>{const refresh=()=>{if(open)void load(false);};window.addEventListener("evolution:shopify-action-created",refresh);return()=>window.removeEventListener("evolution:shopify-action-created",refresh);},[open]);

  const save=async()=>{if(!contract)return;setBusy(true);setSaved(false);setError(null);try{const result=await saveAutonomy({daily_pace:contract.daily_pace,daily_digest:contract.daily_digest});setContract(result.contract);setSaved(true);}catch(cause){setError(cause instanceof Error?cause.message:"Could not save Autopilot.");}finally{setBusy(false);}};
  const decide=async(activity:MarketingActivity,decision:"approve"|"reject")=>{setCampaignBusy(activity.id);setError(null);try{if(activity.kind==="recovery")await recoveryCampaignAction(activity.legacy_id,decision);else if(activity.kind==="winback")await winbackCampaignAction(activity.legacy_id,decision);else if(activity.kind==="review")await reviewCampaignAction(activity.legacy_id,decision);else await broadcastCampaignAction(activity.legacy_id,decision);await load(false);}catch(cause){setError(cause instanceof Error?cause.message:"Could not update this approval.");}finally{setCampaignBusy(null);}};
  const actionChanged=(next:ShopifyActionProposal)=>setActions(rows=>rows.map(row=>row.id===next.id?next:row));

  if(!open)return null;
  const pendingActions=actions.filter(action=>action.status==="proposed"),approvalActivities=activities.filter(activity=>activity.status==="proposed"||activity.status==="blocked"),workingActions=actions.filter(action=>action.status==="executing"),workingActivities=activities.filter(activity=>activity.status==="scheduled"||activity.status==="executing"),completedActions=actions.filter(action=>action.status!=="proposed"&&action.status!=="executing").slice(0,12),failedActivities=activities.filter(activity=>activity.status==="failed"),approvalCount=pendingActions.length+approvalActivities.length+supportApprovals.length,workingCount=workingActions.length+workingActivities.length;

  return <aside className="tools-panel action-center card open" aria-label="Evolution Autopilot">
    <header className="tools-header"><div><span className="manager-kicker">Evolution</span><h2>Autopilot</h2><p>Your agents detect the work, prepare it, and bring every consequential change here.</p></div><button className="link" onClick={onClose}>close</button></header>
    {contract&&<section className="manager-workflows autopilot-settings"><div className="manager-section-head"><div><span>Automatic preparation</span><h3>Agents are working</h3></div><small>{contract.prepared_today} of {contract.max_actions_per_day} prepared today</small></div><div className="autopilot-pace"><label>Daily pace<select value={contract.daily_pace} onChange={event=>setContract({...contract,daily_pace:event.target.value as DailyPace})}><option value="light">Light — {paceCopy.light}</option><option value="balanced">Balanced — {paceCopy.balanced}</option><option value="active">Active — {paceCopy.active}</option></select></label><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save"}</button></div><p className="recovery-muted">Agents make the decision and prepare the complete work. Store changes and customer-facing activity wait for your approval.</p>{saved&&<small>Saved. Your agents will use this pace on the next monitoring cycle.</small>}</section>}
    <nav className="autopilot-tabs" aria-label="Autopilot inbox"><button type="button" className={tab==="approvals"?"active":""} onClick={()=>setTab("approvals")}>Needs approval <strong>{approvalCount}</strong></button><button type="button" className={tab==="working"?"active":""} onClick={()=>setTab("working")}>Working <strong>{workingCount}</strong></button><button type="button" className={tab==="completed"?"active":""} onClick={()=>setTab("completed")}>Completed</button></nav>
    {error&&<p className="overlay-error">{error}</p>}{busy&&!contract&&<p className="recovery-muted">Loading Autopilot…</p>}

    {tab==="approvals"&&<section className="manager-workflows"><div className="manager-section-head"><div><span>One approval inbox</span><h3>{approvalCount?`${approvalCount} finished item${approvalCount===1?"":"s"} ready`:`Nothing needs you`}</h3></div><button className="link" onClick={()=>void load()}>refresh</button></div>
      {!approvalCount&&<p className="recovery-muted">Your agents will place complete, executable work here when they find something worth doing.</p>}
      <div className="action-list">{pendingActions.map(action=><ActionCard key={action.id} initial={action} onChanged={actionChanged}/>)}</div>
      {supportApprovals.length>0&&<div className="decision-cards">{supportApprovals.map(({role,item})=><article className="decision-card state-proposed" key={`${role}:${item.id}`}><header><div><span>{role==="operations"?"Operations Manager":"Customer Success Manager"}</span><h3>Customer update for {item.name}</h3></div><strong>ready</strong></header><p className="decision-conclusion">Evolution found an unresolved fulfillment risk and prepared the exact customer response.</p>{item.notification&&<section className="approval-copy"><strong>{item.notification.subject}</strong><p>{item.notification.body}</p></section>}<section className="after-approval"><span>After approval</span><p>Evolution rechecks the order, sends the reviewed message through the verified sender, and prevents duplicates.</p></section><footer><button className="primary" onClick={()=>onOpenSupport(role,item.id)}>Review &amp; approve</button></footer></article>)}</div>}
      {approvalActivities.length>0&&<div className="decision-cards">{approvalActivities.map(activity=>{const copy=activityCopy(activity);return <article className="decision-card state-proposed" key={activity.id}><header><div><span>{activity.kind} · prepared automatically</span><h3>{activity.title}</h3></div><strong>ready</strong></header><p className="decision-conclusion">{activity.explanation.decision}</p><div className="decision-metrics"><div><span>Audience</span><strong>{activity.audience?.count??0}</strong></div><div><span>Expected profit</span><strong>{money(activity.expected_profit_low)}–{money(activity.expected_profit_high)}</strong></div><div><span>Confidence</span><strong>{Math.round(activity.confidence*100)}%</strong></div></div>{copy&&<section className="approval-copy"><strong>{copy.subject}</strong><p>{copy.body}</p></section>}<details><summary>Evidence and safeguards</summary><div className="decision-detail-grid"><div><h4>Why Evolution prepared this</h4><ul>{activity.explanation.evidence.map(item=><li key={item}>{item}</li>)}</ul></div><div><h4>Safety checks</h4><ul>{activity.explanation.safeguards.map(item=><li key={item}>{item}</li>)}</ul></div></div></details><section className="after-approval"><span>After approval</span><p>{activity.explanation.afterApproval}</p></section><footer><button className="primary" disabled={campaignBusy===activity.id} onClick={()=>void decide(activity,"approve")}>{campaignBusy===activity.id?"Checking live data…":"Approve & execute"}</button><button className="link" disabled={campaignBusy===activity.id} onClick={()=>void decide(activity,"reject")}>Reject</button></footer></article>})}</div>}
    </section>}

    {tab==="working"&&<section className="manager-workflows"><div className="manager-section-head"><div><span>In progress</span><h3>{workingCount?`${workingCount} active item${workingCount===1?"":"s"}`:"Agents are monitoring"}</h3></div></div>{workingActions.map(action=><ActionCard key={action.id} initial={action} onChanged={actionChanged}/>)}{workingActivities.map(activity=><article className="decision-card" key={activity.id}><header><div><span>{activity.kind}</span><h3>{activity.title}</h3></div><strong>{activity.status}</strong></header><p>{activity.explanation.afterApproval}</p></article>)}<div className="action-list">{watching.map(item=><p key={item}>✓ {item}</p>)}</div></section>}

    {tab==="completed"&&<section className="manager-workflows"><div className="manager-section-head"><div><span>History</span><h3>Recent outcomes</h3></div></div>{!completedActions.length&&!failedActivities.length&&<p className="recovery-muted">Approved, rejected, failed, and completed work will appear here.</p>}<div className="action-list">{completedActions.map(action=><ActionCard key={action.id} initial={action} onChanged={actionChanged}/>)}</div>{failedActivities.map(activity=><article className="decision-card state-failed" key={activity.id}><header><div><span>{activity.kind}</span><h3>{activity.title}</h3></div><strong>failed</strong></header><p>{activity.explanation.decision}</p></article>)}</section>}
  </aside>;
}
