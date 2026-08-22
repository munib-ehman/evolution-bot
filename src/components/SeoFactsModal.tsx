import { useEffect } from "react";
import { createPortal } from "react-dom";

export type SeoFacts = { brand:string;productType:string;material:string;useCase:string;features:string };

export function SeoFactsModal({productTitle,facts,busy,onChange,onCancel,onSubmit}:{productTitle:string;facts:SeoFacts;busy:boolean;onChange:(next:SeoFacts)=>void;onCancel:()=>void;onSubmit:()=>void}) {
  const confirmed=Object.values(facts).filter(value=>value.trim()).length;
  useEffect(()=>{
    const previous=document.body.style.overflow;
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)onCancel();};
    document.body.style.overflow="hidden";window.addEventListener("keydown",escape);
    return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",escape);};
  },[busy,onCancel]);
  const field=(key:keyof SeoFacts,label:string,placeholder:string,autoFocus=false)=><label>{label}<input autoFocus={autoFocus} value={facts[key]} placeholder={placeholder} onChange={event=>onChange({...facts,[key]:event.target.value})}/></label>;
  return createPortal(<div className="seo-facts-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel();}}><section className="seo-facts-modal" role="dialog" aria-modal="true" aria-labelledby="seo-facts-title"><header><div><span className="manager-kicker">Review product facts</span><h2 id="seo-facts-title">Prepare {productTitle}</h2></div><button type="button" className="seo-modal-close" aria-label="Close" disabled={busy} onClick={onCancel}>×</button></header><p>Confirm the details loaded from Shopify and add any useful facts that are missing. Evolution also uses the product’s category, category metafields, tags, options and variants automatically.</p><div className="seo-facts-fields">{field("brand","Brand or vendor","Example: Burton",true)}{field("productType","Product type","Example: All-mountain snowboard")}{field("material","Material or construction","Only confirmed materials or construction")}{field("useCase","Intended use or customer type","Example: Beginner resort riding")}{field("features","Verified features","Separate confirmed features with commas")}</div><footer><span className={confirmed?"ready":""}>{confirmed?`${confirmed} visible facts ready · Shopify catalog context included`:"Shopify catalog context will be used automatically"}</span><div><button type="button" className="link" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={onSubmit}>{busy?"Researching and preparing…":"Research and prepare update"}</button></div></footer></section></div>,document.body);
}
