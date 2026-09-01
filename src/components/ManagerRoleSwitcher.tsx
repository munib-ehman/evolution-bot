import { useEffect,useRef,useState } from "react";
import type { Entitlements,ManagerRole } from "../lib/store";

const options:{role:ManagerRole;label:string;summary:string;initials:string}[]=[
  {role:"marketing",label:"Marketing Manager",summary:"Campaigns and revenue",initials:"M"},
  {role:"customer-success",label:"Customer Success Manager",summary:"Retention and support",initials:"CS"},
  {role:"seo",label:"SEO Manager",summary:"Search and discovery",initials:"SEO"},
  {role:"product",label:"Product Manager",summary:"Catalog and listings",initials:"P"},
  {role:"operations",label:"Operations Manager",summary:"Orders and fulfillment",initials:"O"},
];

export function ManagerRoleSwitcher({activeRole,entitlements,onSelect}:{activeRole:ManagerRole;entitlements:Entitlements;onSelect:(role:ManagerRole)=>void}){
  const [open,setOpen]=useState(false),rootRef=useRef<HTMLDivElement>(null);
  const available=options.filter(option=>entitlements[option.role]),active=options.find(option=>option.role===activeRole)??options[0];
  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:PointerEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("pointerdown",dismiss);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",dismiss);document.removeEventListener("keydown",escape);};
  },[open]);
  if(!available.length)return null;
  return <div className={`manager-switcher workspace-role-switcher ${open?"open":""}`} ref={rootRef}>
    <button type="button" className="workspace-role-switcher-trigger" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span>{active.label}</span><i className="manager-switcher-chevron" aria-hidden="true"/>
    </button>
    {open&&<div className="manager-switcher-menu" role="menu" aria-label="Select manager role">
      <span className="manager-switcher-menu-label">Switch workspace</span>
      {available.map(option=><button type="button" role="menuitemradio" aria-checked={option.role===activeRole} className={option.role===activeRole?"active":""} key={option.role} onClick={()=>{setOpen(false);onSelect(option.role);}}>
        <span className={`manager-option-mark role-${option.role}`}>{option.initials}</span>
        <span><strong>{option.label}</strong><small>{option.summary}</small></span>
        {option.role===activeRole&&<i aria-hidden="true">✓</i>}
      </button>)}
    </div>}
  </div>;
}
