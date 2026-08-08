import { useState } from "react";
import { executeAction, undoAction, type ShopifyActionProposal } from "../lib/actions";

const label: Record<ShopifyActionProposal["kind"], string> = {
  product_update: "Product update",
  product_draft_create: "Unpublished product draft",
  collection_upsert: "Collection change",
  discount_code_create: "Discount code",
  discount_automatic_create: "Automatic promotion",
};

function preview(action: ShopifyActionProposal): string[] {
  if (action.kind === "product_update") {
    const items = action.payload.items as { title?: string; productId?: string }[] | undefined;
    return (items ?? []).map((item) => item.title || item.productId || "Product");
  }
  if (action.kind === "product_draft_create") {
    return [String((action.payload.product as { title?: string })?.title ?? "New draft")];
  }
  if (action.kind === "collection_upsert") {
    return [String((action.payload.collection as { title?: string })?.title ?? "Collection")];
  }
  const d = action.payload.discount as { code?: string; valueType?: string; value?: number; endsAt?: string };
  return [
    d.code ? `Code: ${d.code}` : "Applies automatically",
    d.valueType === "free_shipping" ? "Free shipping" : `${d.value ?? ""}${d.valueType === "percentage" ? "%" : " fixed"}`,
    d.endsAt ? `Ends ${new Date(d.endsAt).toLocaleDateString()}` : "No end date",
  ];
}

export function ActionCard({ initial, onChanged }: { initial: ShopifyActionProposal; onChanged?: (action: ShopifyActionProposal) => void }) {
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <section className={`action-card action-${action.status}`}>
      <div className="action-card-head"><strong>{label[action.kind]}</strong><span>{action.status}</span></div>
      <p>{action.summary}</p>
      <ul>{preview(action).map((line, i) => <li key={`${line}:${i}`}>{line}</li>)}</ul>
      {action.status === "proposed" && <p className="action-warning">Nothing changes until you approve.</p>}
      {action.error && <p className="overlay-error">{action.error}</p>}
      {error && <p className="overlay-error">{error}</p>}
      <div className="action-card-buttons">
        {action.status === "proposed" && <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{busy ? "Applying…" : "Approve and apply"}</button>}
        {undoable && <button type="button" className="link" disabled={busy} onClick={() => void undo()}>{busy ? "Working…" : "Undo"}</button>}
      </div>
    </section>
  );
}

