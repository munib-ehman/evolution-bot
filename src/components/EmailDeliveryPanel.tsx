import { useEffect,useState } from "react";
import { getEmailDeliverySettings,saveEmailDeliverySettings,sendEmailDeliveryTest,type EmailDeliverySettings,type EmailRole } from "../lib/emailDelivery";
import { supabase } from "../lib/auth";

export function EmailDeliveryPanel({open,onClose,role}:{open:boolean;onClose:()=>void;role:EmailRole}){
  const [settings,setSettings]=useState<EmailDeliverySettings|null>(null),[replyTo,setReplyTo]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(()=>{if(!open)return;setError(null);void Promise.all([getEmailDeliverySettings(role),supabase?.auth.getUser()]).then(([value,userResult])=>{setSettings(value);const saved=value?.mode==="evolution_shared"&&value.replyTo!==value.senderEmail?value.replyTo:"";setReplyTo(saved||userResult?.data.user?.email?.toLowerCase()||"");}).catch(reason=>setError(reason instanceof Error?reason.message:"Could not load delivery settings."));},[open,role]);
  const approve=async()=>{setBusy(true);setError(null);try{const saved=await saveEmailDeliverySettings(role,{mode:"evolution_shared",senderName:"Evolution",sendingDomain:null,senderEmail:"info@runevolution.io",replyTo,fallbackWarningAcknowledged:true});setSettings(saved);const ready=await sendEmailDeliveryTest(role);setSettings(ready);window.dispatchEvent(new CustomEvent("evolution:delivery-settings",{detail:ready}));}catch(reason){setError(reason instanceof Error?reason.message:"Could not activate email delivery.");}finally{setBusy(false);}};
  return <aside className={`tools-panel delivery-panel card ${open?"open":""}`} aria-hidden={!open} aria-label="Email delivery settings">
    <header className="tools-header"><div><span className="manager-kicker">Email operations</span><h2>{settings?.status==="ready"?"Evolution email is active":"Email activation approval"}</h2><p>Evolution prepared the managed sender and private validation.</p></div><button type="button" className="link" onClick={onClose}>close</button></header>
    <div className={`delivery-readiness ${settings?.status==="ready"?"ready":""}`}><strong>{settings?.status==="ready"?"Ready for approved activities":"One approval required"}</strong><span>{settings?.status==="ready"?"The agent can execute approved campaigns automatically.":"No customer email sends during activation; Evolution only sends you a private validation message."}</span></div>
    <div className="delivery-brand-note"><span>Agent-selected managed sender</span><strong>Evolution &lt;info@runevolution.io&gt;</strong></div>
    {settings?.status!=="ready"&&<div className="delivery-form delivery-shared-form"><label>Agent-selected reply address <small>Your account email is used for validation and customer replies. Change it only if required.</small><input type="email" value={replyTo} onChange={event=>setReplyTo(event.target.value.toLowerCase())} placeholder="you@yourstore.com"/></label></div>}
    {error&&<p className="overlay-error">{error}</p>}
    <div className="delivery-actions">{settings?.status!=="ready"&&<button type="button" className="primary" disabled={busy||!replyTo.trim()} onClick={()=>void approve()}>{busy?"Validating…":"Approve email activation"}</button>}{settings?.status==="ready"&&<span className="delivery-connected-note">✓ Connected and ready</span>}</div>
    <p className="manager-safety"><strong>Evolution handles setup and validation.</strong> After this one approval, only individual customer-facing activities require approval.</p>
  </aside>;
}
