/** The owner's real Shopify connection and its access controls. */
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
        <h2>My Shopify store</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      <ShopifyConnect storeUrl={storeUrl} onDisconnected={onDisconnected} />

      <p className="store-disclaimer">
        <strong>You stay in control.</strong> Evolution connects through Shopify&apos;s authorization
        screen. A store change runs only after you review its before-and-after preview and approve it.
      </p>
    </aside>
  );
}
