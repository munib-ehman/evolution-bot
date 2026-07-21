/**
 * The "My store" panel — connecting the founder's Shopify store, plus the
 * read-only promise, front and center.
 *
 * Advisory era: the ops-queue UI (tool cards, request composer, task list)
 * that used to live here is retired for now — with no write access anywhere,
 * Evolution guides instead of fulfilling. The queue plumbing (lib/tasks.ts,
 * the admin view) is intact; restore the task UI here when write access and
 * fulfillment ship.
 */
import { ShopifyConnect } from "./ShopifyConnect";

export function ToolsPanel({
  open,
  onClose,
  storeUrl,
  onDisconnected,
}: {
  open: boolean;
  onClose: () => void;
  storeUrl: string | null;
  onDisconnected: () => void;
}) {
  return (
    <aside className={`tools-panel card ${open ? "open" : ""}`} aria-hidden={!open} aria-label="My store">
      <header className="tools-header">
        <h2>My store</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      <ShopifyConnect storeUrl={storeUrl} onDisconnected={onDisconnected} />

      <p className="store-disclaimer">
        <strong>Read-only, by design.</strong> Evolution never edits or writes anything on your
        store. The connection only lets us read your data — products, orders, abandoned checkouts —
        so we can analyse your store properly and give you advice based on real numbers, not
        guesses.
      </p>
    </aside>
  );
}
