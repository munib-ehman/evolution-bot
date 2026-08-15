import { useEffect, useState } from "react";
import { fetchActionHistory, type ShopifyActionProposal } from "../lib/actions";
import { ActionCard } from "./ActionCard";

export function ActionCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [actions, setActions] = useState<ShopifyActionProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const history = await fetchActionHistory();
      const newestPendingSeo = new Set<string>();
      setActions(history.filter((action) => {
        if (action.kind !== "product_update" || action.status !== "proposed") return true;
        const productId = (action.payload.items as {productId?:string}[]|undefined)?.[0]?.productId;
        if (!productId || newestPendingSeo.has(productId)) return false;
        newestPendingSeo.add(productId);
        return true;
      }));
    }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load actions."); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open) void refresh(); }, [open]);
  useEffect(() => {
    const created = () => { if (open) void refresh(); };
    window.addEventListener("evolution:shopify-action-created", created);
    return () => window.removeEventListener("evolution:shopify-action-created", created);
  }, [open]);
  const changed = (next: ShopifyActionProposal) => {
    setActions((rows) => rows.map((r) => r.id === next.id ? next : r));
    window.dispatchEvent(new CustomEvent("evolution:shopify-action-changed", { detail: { id:next.id, kind:next.kind, status:next.status } }));
  };

  return (
    <aside className={`tools-panel action-center card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Shopify actions">
      <header className="tools-header">
        <h2>Shopify actions</h2>
        <span><button type="button" className="link" onClick={() => void refresh()}>refresh</button>{" · "}<button type="button" className="link" onClick={onClose}>close</button></span>
      </header>
      <p className="store-disclaimer">Evolution prepares work here. Shopify changes happen only after your approval.</p>
      {loading && <p className="recovery-muted">Loading action history…</p>}
      {error && <p className="overlay-error">{error}</p>}
      {!loading && !error && actions.length === 0 && <p className="recovery-muted">No actions yet. Ask Evolution to improve a listing, create a draft product, organize a collection, or prepare a promotion.</p>}
      <div className="action-list">{actions.map((action) => <ActionCard key={action.id} initial={action} onChanged={changed} />)}</div>
    </aside>
  );
}

