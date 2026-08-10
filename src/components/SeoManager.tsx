import { useEffect, useState } from "react";
import { getSeoSnapshot, type SeoProduct, type SeoSnapshot } from "../lib/seo";

type State = "idle" | "loading" | "ready" | "error";

export function SeoManager({ active, onAsk }: { active: boolean; onAsk: (prompt: string) => void }) {
  const [state, setState] = useState<State>("idle");
  const [snapshot, setSnapshot] = useState<SeoSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setState("loading"); setError(null);
    void getSeoSnapshot().then((next) => { setSnapshot(next); setState("ready"); }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Could not load SEO data."); setState("error");
    });
  };
  useEffect(() => { if (active && state === "idle") load(); }, [active, state]);
  const optimize = (product: SeoProduct, focus: "seo" | "geo") => onAsk(
    focus === "seo"
      ? `Using live Shopify data, prepare a product_update approval card for product ${product.id} (${product.title}) that improves only its product SEO: SEO title, SEO description, description copy where thin, and missing image alt text. Preserve accurate facts, brand voice, price, variants, and inventory. Do not claim it is changed until I approve and execution succeeds.`
      : `Using live Shopify data, prepare a product_update approval card for product ${product.id} (${product.title}) that improves AI/GEO discoverability with clear factual description copy, useful descriptive tags, and image alt text. Do not invent specifications, reviews, certifications, comparisons, or FAQs, and do not claim it is changed until I approve and execution succeeds.`,
  );
  const priority = snapshot?.products[0];
  return <div className="marketing-manager seo-manager">
    <header className="manager-hero"><div><span className="manager-kicker">AI role · active</span><h2>SEO Manager</h2><p>Improves product discovery in traditional search and AI answers using live Shopify catalog evidence.</p></div><span className="manager-status"><i/>Monitoring catalog</span></header>
    <section className="manager-priority"><div><span>Today’s priority</span><strong>{state === "loading" ? "Auditing your catalog…" : priority ? `${priority.title} has the largest combined SEO/GEO opportunity.` : snapshot?.scanned === 0 ? "Add a Shopify product to begin optimization." : "Your catalog is ready for review."}</strong></div><button type="button" className="primary" disabled={!snapshot?.scanned} onClick={() => onAsk("Audit my live Shopify catalog for product SEO and AI/GEO discoverability. Use tools for every finding, prioritize the products with the largest gaps, and do not create or apply changes yet.")}>Ask manager</button></section>
    {error&&<div className="winback-error"><p className="overlay-error">{error}</p><button type="button" onClick={load}>Retry</button></div>}
    <div className="manager-metrics" aria-label="SEO health"><article><span>Product SEO score</span><strong>{snapshot ? snapshot.seoScore : "—"}</strong><small>Search snippets, copy and images</small></article><article><span>AI/GEO score</span><strong>{snapshot ? snapshot.geoScore : "—"}</strong><small>Entity and answer readiness</small></article><article><span>Products needing work</span><strong>{snapshot ? snapshot.needsWork : "—"}</strong><small>{snapshot ? `${snapshot.ready} ready · ${snapshot.scanned} scanned` : "Loading catalog"}</small></article></div>
    <section className="manager-workflows"><div className="manager-section-head"><div><span>Responsibilities</span><h3>Organic discovery</h3></div><button type="button" className="link" onClick={load} disabled={state === "loading"}>Refresh Shopify data</button></div>
      <article className="workflow-card"><div className="workflow-icon">01</div><div><h4>Product SEO</h4><p>Search titles, meta descriptions, product copy, tags, and accessible image text.</p></div><span className={`workflow-state ${snapshot?.seoScore === 100 ? "ready" : "setup"}`}>{snapshot ? `${snapshot.seoScore}/100` : "Loading"}</span><div className="workflow-actions"><button type="button" onClick={() => onAsk("Audit product SEO across my live Shopify catalog. Name the affected products and explain the highest-impact fixes. Do not create changes yet.")}>Run SEO audit in chat</button></div></article>
      <article className="workflow-card"><div className="workflow-icon">02</div><div><h4>AI/GEO Optimization</h4><p>Clear product entities, factual attributes, answer-ready copy, and structured-data readiness.</p></div><span className={`workflow-state ${snapshot?.geoScore === 100 ? "ready" : "setup"}`}>{snapshot ? `${snapshot.geoScore}/100` : "Loading"}</span><div className="workflow-actions"><button type="button" onClick={() => onAsk("Audit my live products for AI/GEO discoverability. Check entity clarity, factual attributes, answer-ready copy, and structured-data readiness. Do not invent facts or create changes yet.")}>Run GEO audit in chat</button></div></article>
    </section>
    {snapshot?.scanned === 0&&<p className="manager-notice">Shopify returned an empty catalog. No optimization or approval draft can be created until a product exists.</p>}
    {(snapshot?.products.length??0)>0&&<section className="seo-products"><div className="manager-section-head"><div><span>Live catalog</span><h3>Priority products</h3></div><small>Worst combined score first</small></div>{snapshot!.products.slice(0,10).map(product=><article className="seo-product" key={product.id}><div><h4>{product.title}</h4><p>{product.issues.length ? product.issues.join(" · ") : "No material gaps detected"}</p></div><div className="seo-product-scores"><span>SEO <b>{product.seoScore}</b></span><span>GEO <b>{product.geoScore}</b></span></div><div className="workflow-actions"><button type="button" disabled={!product.issues.length} onClick={()=>optimize(product,"seo")}>Prepare SEO approval</button><button type="button" disabled={!product.issues.length} onClick={()=>optimize(product,"geo")}>Prepare GEO approval</button></div></article>)}</section>}
    <p className="manager-safety">Audits are read-only. Every Shopify edit is saved as a structured before-and-after proposal and requires your approval before execution. Unsupported facts are never invented.</p>
  </div>;
}
