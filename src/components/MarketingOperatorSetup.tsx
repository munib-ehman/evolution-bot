import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getMarketingProfile, saveMarketingProfile, type MarketingProfile } from "../lib/marketingProfile";

export function MarketingOperatorSetup({open,onClose,scope="marketing"}:{open:boolean;onClose:()=>void;scope?:"marketing"|"customer-success"}){
  const [profile,setProfile]=useState<MarketingProfile|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{if(open){setError(null);void getMarketingProfile().then(setProfile).catch(reason=>setError(reason instanceof Error?reason.message:"Could not load strategy rules."));}},[open]);
  const set=<K extends keyof MarketingProfile>(key:K,value:MarketingProfile[K])=>setProfile(current=>current?{...current,[key]:value}:current);
  const save=async()=>{if(!profile)return;setBusy(true);setError(null);try{setProfile(await saveMarketingProfile(profile));window.dispatchEvent(new Event("evolution:marketing-profile"));onClose();}catch(reason){setError(reason instanceof Error?reason.message:"Could not save strategy rules.");}finally{setBusy(false);}};
  return createPortal(<aside className={`tools-panel recovery-panel operator-setup card ${open?"open":""}`} aria-hidden={!open} aria-label="Marketing operator setup">
    <header className="tools-header"><div><span className="manager-kicker">{scope==="customer-success"?"Customer success intelligence":"Marketing intelligence"}</span><h2>Operator rules</h2><p>Authoritative facts Evolution uses for safety, voice, timing, and customer care.</p></div><button className="link" onClick={onClose}>close</button></header>
    {!profile?(error?<p className="overlay-error">{error}</p>:<p className="recovery-muted">Loading operator rules…</p>):<div className="delivery-form">
      <label>Brand voice and positioning<textarea rows={5} value={profile.brand_voice} onChange={event=>set("brand_voice",event.target.value)} placeholder="Warm, concise, founder-led…"/></label>
      <label>Default gross margin %<input type="number" min="0" max="100" value={profile.default_margin_percent??""} onChange={event=>set("default_margin_percent",event.target.value===""?null:Number(event.target.value))}/></label>
      <label>Maximum discount %<input type="number" min="0" max="100" value={profile.max_discount_percent} onChange={event=>set("max_discount_percent",Number(event.target.value))}/></label>
      <label>Timezone<input value={profile.timezone} onChange={event=>set("timezone",event.target.value)} placeholder="Asia/Karachi"/></label>
      <label>Quiet hours start<input type="time" value={profile.quiet_start.slice(0,5)} onChange={event=>set("quiet_start",event.target.value)}/></label>
      <label>Quiet hours end<input type="time" value={profile.quiet_end.slice(0,5)} onChange={event=>set("quiet_end",event.target.value)}/></label>
      <label>Maximum marketing contacts / 7 days<input type="number" min="1" max="14" value={profile.max_marketing_contacts_7d} onChange={event=>set("max_marketing_contacts_7d",Number(event.target.value))}/></label>
      {scope==="marketing"&&<label>Maximum broadcasts / customer / 7 days<input type="number" min="0" max="7" value={profile.max_broadcast_contacts_7d} onChange={event=>set("max_broadcast_contacts_7d",Number(event.target.value))}/></label>}
      <label>Maximum win-back contacts / customer / 30 days<input type="number" min="0" max="8" value={profile.max_winback_contacts_30d} onChange={event=>set("max_winback_contacts_30d",Number(event.target.value))}/></label>
      <label>Review destination URL<input type="url" value={profile.review_destination??""} onChange={event=>set("review_destination",event.target.value)} placeholder="https://…"/></label>
      <label><input type="checkbox" checked={profile.approval_alerts} onChange={event=>set("approval_alerts",event.target.checked)}/> Email me when an approval or exception needs attention</label>
      {error&&<p className="overlay-error">{error}</p>}<button className="primary" disabled={busy||!profile.brand_voice.trim()||profile.default_margin_percent===null} onClick={()=>void save()}>{busy?"Saving…":"Save operator rules"}</button>
    </div>}
  </aside>,document.body);
}
