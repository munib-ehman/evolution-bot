import { useState } from "react";
import { executeAction, rejectAction, undoAction, updateAction, type ShopifyActionProposal } from "../lib/actions";

type EditableProduct = { title?:string; productId:string; seoTitle?:string; seoDescription?:string; descriptionHtml?:string; descriptionText?:string; tags?:string[]; vendor?:string; productType?:string; mediaAlt?:{id:string;alt:string}[] };
const plainText = (value?:string) => (value ?? "").replace(/<br\s*\/?>/gi,"\n").replace(/<\/p>/gi,"\n\n").replace(/<[^>]*>/g," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\n{3,}/g,"\n\n").trim();
const toDescriptionHtml = (value:string) => value.trim().split(/\n\s*\n/).filter(Boolean).map(paragraph=>`<p>${paragraph.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>")}</p>`).join("");

const label: Record<ShopifyActionProposal["kind"], string> = {
  product_update: "Product update",
  product_status_update: "Product lifecycle change",
  product_draft_create: "Unpublished product draft",
  collection_upsert: "Collection change",
  discount_code_create: "Discount code",
  discount_automatic_create: "Automatic promotion",
};

function preview(action: ShopifyActionProposal): string[] {
  if (action.kind === "product_update" || action.kind === "product_status_update") {
    const items = action.payload.items as { title?: string; productId?: string; status?:string; seoTitle?:string; seoDescription?:string; descriptionHtml?:string; tags?:string[]; vendor?:string; productType?:string; mediaAlt?:{id:string;alt:string}[] }[] | undefined;
    const before = action.before_state.products as {id:string;title:string;status?:string;descriptionHtml?:string;seo?:{title?:string|null;description?:string|null};tags?:string[];vendor?:string;productType?:string}[]|undefined;
    return (items ?? []).flatMap((item) => {
      const previous = before?.find(product=>product.id===item.productId);
      const name = item.title || previous?.title || item.productId || "Product";
      const changes = [
        item.seoTitle !== undefined ? `Search title: ${previous?.seo?.title||"(default product title)"} → ${item.seoTitle}` : "",
        item.seoDescription !== undefined ? `Meta description: ${previous?.seo?.description||"(empty)"} → ${item.seoDescription}` : "",
        item.descriptionHtml !== undefined ? `Description: ${item.descriptionHtml.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,180)}${item.descriptionHtml.length>180?"…":""}` : "",
        item.tags !== undefined ? `Tags: ${item.tags.join(", ")}` : "",
        item.vendor !== undefined ? `Vendor/brand: ${previous?.vendor||"(empty)"} → ${item.vendor}` : "",
        item.productType !== undefined ? `Product type: ${previous?.productType||"(empty)"} → ${item.productType}` : "",
        item.mediaAlt?.length ? `Image alt text: ${item.mediaAlt.length} image${item.mediaAlt.length===1?"":"s"}` : "",
        item.status !== undefined ? `Status: ${previous?.status??"current"} → ${item.status}` : "",
      ].filter(Boolean);
      return [name, ...changes];
    });
  }
  if (action.kind === "product_draft_create") {
    const product=action.payload.product as {title?:string;price?:number|null;descriptionHtml?:string;productType?:string;tags?:string[]};
    return [String(product?.title??"New draft"),"Status: Unpublished Shopify draft",product?.productType?`Product type: ${product.productType}`:"",product?.descriptionHtml?`Optimized product description: ${plainText(product.descriptionHtml)}`:"",product?.tags?.length?`Catalog tags: ${product.tags.join(", ")}`:"",product?.price?`Recommended initial price: ${product.price}`:"Price needs confirmation"].filter(Boolean);
  }
  if (action.kind === "collection_upsert") {
    const title = String((action.payload.collection as { title?: string })?.title ?? "Collection");
    const selected = (action.payload.selectedProducts as {id:string;title:string}[]|undefined) ?? [];
    return [title, selected.length ? `${selected.length} product${selected.length===1?"":"s"}: ${selected.map(product=>product.title).join(", ")}` : "No products selected"];
  }
  const d = action.payload.discount as { code?: string; valueType?: string; value?: number; endsAt?: string };
  return [
    d.code ? `Code: ${d.code}` : "Applies automatically",
    d.valueType === "free_shipping" ? "Free shipping" : `${d.value ?? ""}${d.valueType === "percentage" ? "%" : " fixed"}`,
    d.endsAt ? `Ends ${new Date(d.endsAt).toLocaleDateString()}` : "No end date",
  ];
}

function evidencePreview(action: ShopifyActionProposal): string[] {
  if (action.kind === "product_status_update") return preview(action);
  if (action.kind !== "product_update" || !action.payload.evidence) return preview(action);
  const items = action.payload.items as {productId?:string;title?:string;seoTitle?:string;seoDescription?:string;descriptionHtml?:string;tags?:string[]}[]|undefined;
  const before = action.before_state.products as {id:string;title:string;descriptionHtml?:string;seo?:{title?:string|null;description?:string|null};tags?:string[]}[]|undefined;
  const plain = (value?:string|null) => (value||"(empty)").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  return (items??[]).flatMap(item=>{
    const previous = before?.find(product=>product.id===item.productId);
    const listingVa = Boolean((action.payload.evidence as {listingVa?:unknown}|undefined)?.listingVa);
    return [
      previous?.title||item.title||item.productId||"Product",
      listingVa&&item.title!==undefined?`Storefront title BEFORE: ${previous?.title||"(empty)"}`:"",
      listingVa&&item.title!==undefined?`Storefront title PROPOSED: ${item.title}`:"",
      item.seoTitle!==undefined?`Search title BEFORE: ${previous?.seo?.title||"(default product title)"}`:"",
      item.seoTitle!==undefined?`Search title PROPOSED: ${item.seoTitle}`:"",
      item.seoDescription!==undefined?`Meta description BEFORE: ${previous?.seo?.description||"(empty)"}`:"",
      item.seoDescription!==undefined?`Meta description PROPOSED: ${item.seoDescription}`:"",
      item.descriptionHtml!==undefined?`Description BEFORE: ${plain(previous?.descriptionHtml).slice(0,180)}`:"",
      item.descriptionHtml!==undefined?`Description PROPOSED: ${plain(item.descriptionHtml)}`:"",
      item.tags!==undefined?`Tags BEFORE: ${previous?.tags?.join(", ")||"(none)"}`:"",
      item.tags!==undefined?`Tags PROPOSED: ${item.tags.join(", ")}`:"",
    ].filter(Boolean);
  });
}

export function ActionCard({ initial, onChanged }: { initial: ShopifyActionProposal; onChanged?: (action: ShopifyActionProposal) => void }) {
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftItems, setDraftItems] = useState<EditableProduct[]>(() => ((initial.payload.items as EditableProduct[]|undefined) ?? []).map(item=>({...item,descriptionText:plainText(item.descriptionHtml)})));
  const setDraft = (index:number, patch:Partial<EditableProduct>) => setDraftItems(items=>items.map((item,i)=>i===index?{...item,...patch}:item));
  const saveEdits = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const items = draftItems.map(({descriptionText,...item})=>({
        ...item,
        ...(item.descriptionHtml !== undefined ? {descriptionHtml:toDescriptionHtml(descriptionText ?? "")} : {}),
      }));
      const next = await updateAction(action.id,items);
      setAction(next); setEditing(false); onChanged?.(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save your edits."); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    if (busy || !window.confirm(`Reject this prepared update?\n\n${action.summary}`)) return;
    setBusy(true); setError(null);
    try { const next = await rejectAction(action.id); setAction(next); setEditing(false); onChanged?.(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't reject this update."); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy || !window.confirm(`Apply this change to Shopify?\n\n${action.summary}`)) return;
    setBusy(true); setError(null);
    try { const next = await executeAction(action.id); setAction(next); onChanged?.(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    if (busy || !window.confirm(`Undo this Shopify action?\n\n${action.summary}`)) return;
    setBusy(true); setError(null);
    try { const next = await undoAction(action.id); setAction(next); onChanged?.(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Undo failed."); }
    finally { setBusy(false); }
  };
  const undoable = (action.status === "succeeded" || action.status === "partial") && Boolean(action.executed_at) && Date.now() - Date.parse(action.executed_at!) <= 86_400_000;
  const evidence = action.kind === "product_update" || action.kind === "product_status_update" ? action.payload.evidence as {
    keywords?: {keyword:string;evidence:string;sourceUrl:string}[];
    marketplace?: {source:string;observation:string;metric?:string;sourceUrl:string}[];
    rationale?: string;
    limitations?: string;
    review?: {currentListing?:string;shopperIntent?:string;keywordUse?:string;titleAdvice?:string;descriptionAdvice?:string;tagAdvice?:string};
    geo?: {label?:string;improves?:string[];safeguards?:string[];manualGaps?:string[]};
    catalogContext?: {category?:string;existingTags?:string[];attributes?:{label:string;value:string;source:"category"|"product"}[]};
    listingVa?: {audit?:string[];shopperIntent?:string;titleStrategy?:string;descriptionStrategy?:string;tagStrategy?:string;imagePlan?:string[];missingFacts?:string[];preserved?:string[]};
  } | undefined : undefined;
  const researchEvidence = action.kind === "product_draft_create" ? action.payload.evidence as {research?:{market?:string;fit?:string;sources?:{title?:string;url?:string}[];sourcing?:{supplier?:string;unitCost?:string;url?:string}[]};listingVa?:{optimizedByDefault?:boolean;descriptionWords?:number;bullets?:number;protected?:string[]};limitations?:string}|undefined : undefined;
  return (
    <section className={`action-card action-${action.status}`}>
      <div className="action-card-head"><strong>{label[action.kind]}</strong><span>{action.status}</span></div>
      <p>{action.summary}</p>
      {evidence && <div className="action-evidence">
        <h4>{evidence.listingVa ? "Product Listing VA review" : "Why these changes"}</h4>
        {evidence.rationale && <p>{evidence.rationale}</p>}
        {evidence.listingVa && <div className="seo-strategy-review">
          {!!evidence.listingVa.audit?.length&&<><h4>Listing audit</h4><ul>{evidence.listingVa.audit.map(item=><li key={item}>{item}</li>)}</ul></>}
          {evidence.listingVa.shopperIntent&&<><h4>Shopper intent and marketplace language</h4><p>{evidence.listingVa.shopperIntent}</p></>}
          {evidence.listingVa.titleStrategy&&<><h4>Storefront title strategy</h4><p>{evidence.listingVa.titleStrategy}</p></>}
          {evidence.listingVa.descriptionStrategy&&<><h4>Product description strategy</h4><p>{evidence.listingVa.descriptionStrategy}</p></>}
          {evidence.listingVa.tagStrategy&&<><h4>Catalog tag strategy</h4><p>{evidence.listingVa.tagStrategy}</p></>}
          {!!evidence.listingVa.imagePlan?.length&&<><h4>Product media plan</h4><ul>{evidence.listingVa.imagePlan.map(item=><li key={item}>{item}</li>)}</ul></>}
          {!!evidence.listingVa.missingFacts?.length&&<><h4>Information still needed</h4><ul>{evidence.listingVa.missingFacts.map(item=><li key={item}>{item}</li>)}</ul></>}
          {!!evidence.listingVa.preserved?.length&&<><h4>Protected fields</h4><p>{evidence.listingVa.preserved.join(" · ")}</p></>}
        </div>}
        {!evidence.listingVa && evidence.review && <div className="seo-strategy-review">
          {evidence.review.currentListing && <><h4>What’s happening with the current listing</h4><p>{evidence.review.currentListing}</p></>}
          {evidence.review.shopperIntent && <><h4>What shoppers appear to be looking for</h4><p>{evidence.review.shopperIntent}</p></>}
          {evidence.review.keywordUse && <><h4>How to use the keywords</h4><p>{evidence.review.keywordUse}</p></>}
          {evidence.review.titleAdvice && <><h4>Search title recommendation</h4><p>{evidence.review.titleAdvice}</p></>}
          {evidence.review.descriptionAdvice && <><h4>Description recommendation</h4><p>{evidence.review.descriptionAdvice}</p></>}
          {evidence.review.tagAdvice && <><h4>Tag recommendation</h4><p>{evidence.review.tagAdvice}</p></>}
        </div>}
        {evidence.geo && <div className="seo-strategy-review"><h4>{evidence.geo.label || "AI/GEO optimization"}</h4><p><strong>Prepared:</strong> {evidence.geo.improves?.join(" · ")}</p>{Boolean(evidence.geo.manualGaps?.length)&&<p><strong>Still needs confirmation:</strong> {evidence.geo.manualGaps?.join(" · ")}</p>}<small>{evidence.geo.safeguards?.join(" · ")}</small></div>}
        {evidence.catalogContext && <div className="seo-strategy-review"><h4>Shopify catalog facts used</h4>{evidence.catalogContext.category&&<p><strong>Category:</strong> {evidence.catalogContext.category}</p>}{Boolean(evidence.catalogContext.existingTags?.length)&&<p><strong>Existing tags:</strong> {evidence.catalogContext.existingTags?.join(" · ")}</p>}{Boolean(evidence.catalogContext.attributes?.length)&&<p>{evidence.catalogContext.attributes?.map(attribute=>`${attribute.label}: ${attribute.value}`).join(" · ")}</p>}</div>}
        {!!evidence.keywords?.length && <><h4>Suggested keywords</h4><ul>{evidence.keywords.map((entry, index) => <li key={`${entry.keyword}:${index}`}><strong>{entry.keyword}</strong> — {entry.evidence} <a href={entry.sourceUrl} target="_blank" rel="noreferrer">source</a></li>)}</ul></>}
        {!!evidence.marketplace?.length && <><h4>Marketplace evidence</h4><ul>{evidence.marketplace.map((entry, index) => <li key={`${entry.source}:${index}`}><strong>{entry.source}</strong>: {entry.observation}{entry.metric ? ` (${entry.metric})` : ""} <a href={entry.sourceUrl} target="_blank" rel="noreferrer">source</a></li>)}</ul></>}
        {evidence.limitations && <p className="action-warning"><strong>Evidence limits:</strong> {evidence.limitations}</p>}
        <h4>Before / proposed</h4>
      </div>}
      {researchEvidence?.research&&<div className="action-evidence"><h4>Private launch evidence</h4><p>{researchEvidence.research.fit}</p><p><strong>Market:</strong> {researchEvidence.research.market??"store default"}</p>{researchEvidence.listingVa?.optimizedByDefault&&<p><strong>Listing VA optimized by default:</strong> {researchEvidence.listingVa.descriptionWords??0} description words · {researchEvidence.listingVa.bullets??0} product highlights</p>}{Boolean(researchEvidence.research.sources?.length)&&<><h4>Research sources</h4><ul>{researchEvidence.research.sources?.map((source,index)=><li key={`${source.url}:${index}`}>{source.url?<a href={source.url} target="_blank" rel="noreferrer">{source.title||`Source ${index+1}`}</a>:source.title}</li>)}</ul></>}{Boolean(researchEvidence.research.sourcing?.length)&&<><h4>Supplier searches</h4><ul>{researchEvidence.research.sourcing?.map((source,index)=><li key={`${source.supplier}:${index}`}>{source.url?<a href={source.url} target="_blank" rel="noreferrer"><strong>{source.supplier}</strong></a>:<strong>{source.supplier}</strong>}{source.unitCost?` · ${source.unitCost}`:""}</li>)}</ul></>}{Boolean(researchEvidence.listingVa?.protected?.length)&&<p><strong>Safety:</strong> {researchEvidence.listingVa?.protected?.join(" · ")}</p>}{researchEvidence.limitations&&<p className="action-warning">{researchEvidence.limitations}</p>}</div>}
      {!editing && <ul>{evidencePreview(action).map((line, i) => <li key={`${line}:${i}`}>{line}</li>)}</ul>}
      {editing && <div className="action-edit-form">{draftItems.map((item,index)=><fieldset key={item.productId}><legend>{item.title || "Product listing"}</legend>
        {item.title !== undefined && <label>Storefront title<input value={item.title} maxLength={255} onChange={event=>setDraft(index,{title:event.target.value})} /></label>}
        {item.seoTitle !== undefined && <label>Search title<input value={item.seoTitle} maxLength={60} onChange={event=>setDraft(index,{seoTitle:event.target.value})} /><small>{item.seoTitle.length}/60 characters</small></label>}
        {item.seoDescription !== undefined && <label>Meta description<textarea value={item.seoDescription} maxLength={160} rows={3} onChange={event=>setDraft(index,{seoDescription:event.target.value})} /><small>{item.seoDescription.length}/160 characters</small></label>}
        {item.descriptionHtml !== undefined && <label>Product description<textarea value={item.descriptionText} rows={6} onChange={event=>setDraft(index,{descriptionText:event.target.value})} /></label>}
        {item.tags !== undefined && <label>Tags<input value={item.tags.join(", ")} onChange={event=>setDraft(index,{tags:event.target.value.split(",").map(value=>value.trim()).filter(Boolean)})} /><small>Separate tags with commas</small></label>}
        {item.vendor !== undefined && <label>Vendor / brand<input value={item.vendor} maxLength={255} onChange={event=>setDraft(index,{vendor:event.target.value})} /></label>}
        {item.productType !== undefined && <label>Product type<input value={item.productType} maxLength={255} onChange={event=>setDraft(index,{productType:event.target.value})} /></label>}
      </fieldset>)}</div>}
      {action.status === "proposed" && <p className="action-warning">Nothing changes until you approve.</p>}
      {action.error && <p className="overlay-error">{action.error}</p>}
      {error && <p className="overlay-error">{error}</p>}
      <div className="action-card-buttons">
        {action.status === "proposed" && !editing && <><button type="button" className="link" disabled={busy} onClick={() => void reject()}>Reject</button>{action.kind === "product_update" && <button type="button" className="link" disabled={busy} onClick={() => setEditing(true)}>Edit suggestion</button>}<button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{busy ? "Applying…" : "Approve and apply"}</button></>}
        {action.status === "proposed" && editing && <><button type="button" className="link" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={() => void saveEdits()}>{busy ? "Saving…" : "Save edits"}</button></>}
        {undoable && <button type="button" className="link" disabled={busy} onClick={() => void undo()}>{busy ? "Working…" : "Undo"}</button>}
      </div>
    </section>
  );
}

