import { useEffect, useState } from "react";
import { getSeoSnapshot, optimizeSeoProduct, type SeoOptimizationResult, type SeoProduct, type SeoSnapshot } from "../lib/seo";
import type { ShopifyActionProposal } from "../lib/actions";
import { fetchActionHistory } from "../lib/actions";
import { SeoFactsModal, type SeoFacts } from "./SeoFactsModal";
import { ThemeRepairGuide } from "./ThemeRepairGuide";

type State = "idle" | "loading" | "ready" | "error";

export function SeoManager({ active, onAsk, onProposal }: { active: boolean; onAsk: (prompt: string) => void; onProposal: (action: ShopifyActionProposal) => void }) {
  const [state, setState] = useState<State>("idle");
  const [snapshot, setSnapshot] = useState<SeoSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SeoOptimizationResult>>({});
  const [factProduct, setFactProduct] = useState<SeoProduct | null>(null);
  const [facts, setFacts] = useState<SeoFacts>({ brand: "", productType: "", material: "", useCase: "", features: "" });
  const [repairGuideOpen,setRepairGuideOpen]=useState(false);

  const load = () => {
    setState("loading"); setError(null);
    void Promise.all([getSeoSnapshot(), fetchActionHistory()]).then(([next, history]) => {
      setSnapshot(next);
      const restored: Record<string, SeoOptimizationResult> = {};
      for (const action of history) {
        if (action.kind !== "product_update" || !action.payload.optimizerVersion) continue;
        const item = (action.payload.items as {productId?:string;descriptionHtml?:string}[]|undefined)?.[0];
        if (!item?.productId || restored[item.productId]) continue;
        const plan = action.payload.keywordPlan as {candidates?:SeoOptimizationResult["keywords"]}|undefined;
        const sources = action.payload.sourceStatus as SeoOptimizationResult["sources"]|undefined;
        restored[item.productId] = {
          action,
          keywords: Array.isArray(plan?.candidates) ? plan!.candidates! : [],
          sources: Array.isArray(sources) ? sources : [],
          missingFacts: item.descriptionHtml ? [] : ["optional product details"],
        };
      }
      setResults(restored);
      setState("ready");
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Could not load SEO data."); setState("error");
    });
  };
  useEffect(() => { if (active && state === "idle") load(); }, [active, state]);
  useEffect(() => {
    if (!active) return;
    const refreshAfterAction = () => load();
    window.addEventListener("evolution:shopify-action-changed", refreshAfterAction);
    return () => window.removeEventListener("evolution:shopify-action-changed", refreshAfterAction);
  }, [active]);

  const optimize = async (product: SeoProduct, withFacts = false) => {
    if (optimizingId) return;
    if (!withFacts) {
      setFacts({brand:product.vendorName,productType:product.productTypeName,material:"",useCase:"",features:""});
      setFactProduct(product); return;
    }
    setOptimizingId(product.id); setOptimizationError(null);
    try {
      const confirmed: Record<string, string> = withFacts ? { material: facts.material, useCase: facts.useCase, features: facts.features } : {};
      const result = await optimizeSeoProduct(product.id, confirmed);
      setResults((previous) => ({ ...previous, [product.id]: result }));
      if (result.missingFacts.length) setFactProduct(product);
      else { setFactProduct(null); setFacts({ brand: "", productType: "", material: "", useCase: "", features: "" }); }
      onProposal(result.action);
    } catch (cause) {
      setOptimizationError(cause instanceof Error ? cause.message : "Could not optimize this product.");
    } finally { setOptimizingId(null); }
  };

  const priority = snapshot?.products[0];
  const improvedCount = snapshot?.products.filter(product=>results[product.id]?.action.status === "succeeded").length ?? 0;
  const sourceName = (source: string) => source === "google_suggest" ? "Google searches" : source === "amazon" ? "Amazon" : "eBay";
  return <div className="marketing-manager seo-manager">
    <header className="manager-hero"><div><span className="manager-kicker">SEO + GEO Manager · active</span><h2>SEO Manager</h2><p>Improves traditional search visibility and makes verified product facts clearer to AI answer engines.</p></div><span className="manager-status"><i />Watching your catalog</span></header>
    <section className="manager-priority"><div><span>Today’s priority</span><strong>{state === "loading" ? "Reviewing your catalog…" : state === "error" ? "Connect Shopify to review your products." : priority ? `${priority.title} has the biggest search visibility opportunity.` : snapshot?.scanned === 0 ? "Add a Shopify product to begin." : "Your catalog is ready for review."}</strong></div><button type="button" className="primary" disabled={!snapshot?.scanned} onClick={() => priority && void optimize(priority)}>{optimizingId === priority?.id ? "Researching…" : "Improve top product"}</button></section>
    {error && <div className="winback-error"><p className="overlay-error">{error}</p>{error !== "Connect Shopify first." && <button type="button" onClick={load}>Try again</button>}</div>}
    {optimizationError && <div className="winback-error"><p className="overlay-error">{optimizationError}</p></div>}
    <div className="manager-metrics" aria-label="SEO health"><article><span>Google listing score</span><strong>{snapshot ? snapshot.seoScore : "—"}</strong><small>Titles, descriptions and images</small></article><article><span>AI/GEO readiness</span><strong>{snapshot ? snapshot.overallGeoScore : "—"}</strong><small>{snapshot ? `Content ${snapshot.geoScore} · Technical ${snapshot.technicalGeo.score}` : "Content and technical discovery"}</small></article><article><span>Products needing work</span><strong>{snapshot ? snapshot.needsWork : "—"}</strong><small>{snapshot ? `${snapshot.ready} fully ready · ${improvedCount} improved · ${snapshot.scanned} checked` : "Loading catalog"}</small></article></div>
    <section className="seo-geo-explainer"><div><span className="manager-kicker">AI/GEO optimization</span><h3>Make products easy to understand accurately</h3><p>Evolution checks entity identity, factual description depth, classification, and image context. It prepares supported changes without promising placement in an AI answer.</p></div></section>
    {snapshot?.technicalGeo && <section className="seo-technical"><div className="manager-section-head"><div><span>Technical discovery and repair</span><h3>AI and search accessibility</h3></div><strong className="seo-technical-score">{snapshot.technicalGeo.score}/100</strong></div><div className="seo-technical-grid">{snapshot.technicalGeo.checks.map(check=><article className={check.passed?"passed":"needs-work"} key={check.id}><span>{check.passed?"Pass":"Needs work"}</span><h4>{check.label}</h4><p>{check.detail}</p>{check.fix&&<small>{check.fix}</small>}</article>)}</div><div className="seo-repair-actions"><div><span className="seo-kit-kicker">Guided theme fixes</span><strong>Fix the failed Shopify checks</strong><small>Step-by-step instructions, only the files you need, and a live installation test.</small></div><button type="button" className="seo-download-button" onClick={()=>setRepairGuideOpen(true)}><span className="seo-download-icon" aria-hidden="true">→</span><span><strong>Open setup guide</strong><small>No technical experience needed</small></span></button></div><p className="manager-safety">Technical readiness improves eligibility; it cannot guarantee rankings or AI citations.</p></section>}
    {snapshot?.scanned === 0 && <p className="manager-notice">Shopify returned an empty catalog. No optimization can be prepared until a product exists.</p>}
    {(snapshot?.products.length ?? 0) > 0 && <section className="seo-products"><div className="manager-section-head"><div><span>Products</span><h3>Your catalog</h3></div><button type="button" className="link" onClick={load} disabled={state === "loading"}>Refresh</button></div>{snapshot!.products.slice(0, 10).map((product) => {
      const result = results[product.id];
      const applied = result?.action.status === "succeeded";
      const ready = product.issues.length === 0;
      return <article className={`seo-product ${ready?"is-ready":applied?"is-improved":""}`} key={product.id}><div><div className="seo-product-title"><h4>{product.title}</h4>{ready?<span className="seo-state ready">Ready ✓</span>:applied?<span className="seo-state improved">Improved</span>:null}</div><p>{ready ? "All measured product SEO and GEO checks pass." : applied ? `Applied update reflected in Shopify · ${product.issues.length} gap${product.issues.length===1?"":"s"} remaining: ${product.issues.join(" · ")}` : product.issues.join(" · ")}</p><details className="seo-geo-checks"><summary>AI/GEO readiness details</summary>{product.geoChecks.map(check=><p key={check.label}><b>{check.passed ? "✓" : "Needs work"} · {check.label}</b><small>{check.detail}</small></p>)}</details>{result && <div className="seo-inline-evidence"><strong>{result.action.status === "proposed" ? "SEO + GEO update ready" : applied ? "Latest update applied to Shopify" : result.action.status === "rejected" ? "Suggestion rejected" : "Latest research"}: {result.keywords[0]?.keyword || "keyword plan saved"}</strong><small>{result.keywords.slice(0, 4).map((keyword) => `${keyword.keyword} (${keyword.score}/100)`).join(" · ")}</small><small>{result.sources.map((source) => `${sourceName(source.source)}: ${source.status === "available" ? `${source.observations} results checked` : "not available"}`).join(" · ")}</small></div>}</div><div className="seo-product-scores"><span>Google <b>{product.seoScore}</b></span><span>AI/GEO <b>{product.geoScore}</b></span></div><div className="workflow-actions">{result&&<button type="button" className="link" onClick={()=>onProposal(result.action)}>{applied?"View applied update":"View prepared update"}</button>}{!ready&&(!result||applied||result.action.status==="rejected")&&<button type="button" disabled={Boolean(optimizingId)} onClick={()=>void optimize(product)}>{optimizingId===product.id?"Researching…":applied?"Continue improving":"Prepare SEO + GEO update"}</button>}</div></article>;
    })}</section>}
    {factProduct && <SeoFactsModal productTitle={factProduct.title} facts={facts} busy={Boolean(optimizingId)} onChange={setFacts} onCancel={()=>setFactProduct(null)} onSubmit={()=>void optimize(factProduct,true)}/>} 
    {repairGuideOpen&&snapshot&&<ThemeRepairGuide shop={snapshot.shop} checks={snapshot.technicalGeo.checks} onClose={()=>setRepairGuideOpen(false)} onTest={async()=>{const next=await getSeoSnapshot();setSnapshot(next);return next.technicalGeo;}}/>}
    <p className="manager-safety">Every recommendation shows where the keyword evidence came from. If reliable search volume is unavailable, we say so. Nothing changes until you approve the before-and-after update.</p>
  </div>;
}
