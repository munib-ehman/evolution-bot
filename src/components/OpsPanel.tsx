/**
 * The Operations Center — the live operator view.
 *
 * While open, it polls /api/ops-snapshot every 60s (paused when the tab is
 * hidden) so the owner sees the store as it is right now: today's pulse,
 * every order waiting to ship (oldest first, stale ones flagged), and the
 * inventory watch (sold-out = lost sales until restocked, low stock = about
 * to be). Read-only; nothing here writes to the store.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatMoney,
  getOpsSnapshot,
  OpsError,
  type InventoryProduct,
  type OpsSnapshot,
  type ShipQueueOrder,
} from "../lib/ops";
import { supabase } from "../lib/auth";
import {
  enableLiveUpdates,
  fetchRecentEvents,
  subscribeToEvents,
  type StoreEvent,
} from "../lib/events";

const REFRESH_MS = 60_000;
/** An unshipped order older than this is flagged as overdue. */
const OVERDUE_HOURS = 48;

function hoursSince(iso: string): number {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0;
}

function waitingLabel(iso: string): string {
  const hours = hoursSince(iso);
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""}`;
}

function eventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function updatedLabel(fetchedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export function OpsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [events, setEvents] = useState<StoreEvent[]>([]);
  const [live, setLive] = useState<{ live: boolean; reason?: string } | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const inFlight = useRef(false);
  const hasData = useRef(false);
  const liveSetup = useRef(false);

  const refresh = useCallback(async (showSpinner: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (showSpinner) setLoading(true);
    try {
      const snap = await getOpsSnapshot();
      setSnapshot(snap);
      hasData.current = true;
      setFetchedAt(Date.now());
      setLoadError(null);
    } catch (err) {
      // Keep showing the last good snapshot on background-refresh failures.
      setLoadError(
        err instanceof OpsError && err.status === 409
          ? "Connect your Shopify store first (My store panel) — operations watches your real store."
          : err instanceof OpsError
            ? err.message
            : "Couldn't reach your store. Retrying on the next refresh.",
      );
    } finally {
      inFlight.current = false;
      if (showSpinner) setLoading(false);
    }
  }, []);

  // Fetch on open, then poll while open (skipping when the tab is hidden).
  // Polling is the safety net under the push channel — webhooks can be missed.
  useEffect(() => {
    if (!open) return;
    void refresh(!hasData.current);
    const poll = window.setInterval(() => {
      if (!document.hidden) void refresh(false);
    }, REFRESH_MS);
    return () => window.clearInterval(poll);
  }, [open, refresh]);

  // First open: turn on live push (idempotent webhook registration) and load
  // the recent feed.
  useEffect(() => {
    if (!open || liveSetup.current) return;
    liveSetup.current = true;
    void (async () => {
      const [status, recent] = await Promise.all([enableLiveUpdates(), fetchRecentEvents(20)]);
      setLive(status);
      setEvents(recent);
    })();
  }, [open]);

  // While open: stream events over the WebSocket — prepend to the feed and
  // refresh the snapshot immediately so the numbers move with the event.
  useEffect(() => {
    if (!open) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId || cancelled) return;
      unsubscribe = subscribeToEvents(
        userId,
        (event) => {
          setEvents((cur) => (cur.some((e) => e.id === event.id) ? cur : [event, ...cur].slice(0, 30)));
          void refresh(false);
        },
        "store-events-ops",
      );
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [open, refresh]);

  // A slow tick so "updated Xs ago" stays honest.
  useEffect(() => {
    if (!open) return;
    const tick = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(tick);
  }, [open]);

  const overdue = (snapshot?.shipQueue ?? []).filter((o) => hoursSince(o.createdAt) >= OVERDUE_HOURS);

  return (
    <aside
      className={`tools-panel recovery-panel ops-panel card ${open ? "open" : ""}`}
      aria-hidden={!open}
      aria-label="Operations"
    >
      <header className="tools-header">
        <h2>Operations</h2>
        <button type="button" className="link" onClick={onClose}>
          close
        </button>
      </header>

      {snapshot && (
        <p className="ops-live">
          <span className="ops-live-dot" aria-hidden="true" />
          {live?.live ? "Live push on" : "Live"} · updated {updatedLabel(fetchedAt, now)} ·{" "}
          <button type="button" className="link" onClick={() => void refresh(false)}>
            refresh now
          </button>
          {notifPerm === "default" && (
            <>
              {" · "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  void Notification.requestPermission().then(setNotifPerm);
                }}
              >
                enable popup alerts
              </button>
            </>
          )}
        </p>
      )}
      {live && !live.live && live.reason && <p className="recovery-muted">{live.reason}</p>}

      {loading && !snapshot && <p className="recovery-muted">Reading your store…</p>}
      {loadError && !snapshot && !loading && <p className="overlay-error">{loadError}</p>}
      {loadError && snapshot && <p className="recovery-muted">{loadError}</p>}

      {snapshot && (
        <>
          <section className="ops-stats" aria-label="Today">
            <div className="ops-stat">
              <strong>{snapshot.today.orders}</strong>
              <span>orders today</span>
            </div>
            <div className="ops-stat">
              <strong>{formatMoney(snapshot.today.revenue, snapshot.currency)}</strong>
              <span>revenue today</span>
            </div>
            <div className="ops-stat">
              <strong>{snapshot.today.abandoned}</strong>
              <span>abandoned today</span>
            </div>
          </section>

          <section className="recovery-carts">
            <h3>Live feed</h3>
            {events.length === 0 && (
              <p className="recovery-muted">
                Quiet so far — new orders and stock alerts will appear here the moment they happen.
              </p>
            )}
            {events.map((e) => (
              <p key={e.id} className="ops-event">
                <span className="ops-event-time">{eventTime(e.created_at)}</span> {e.title}
              </p>
            ))}
          </section>

          <section className="recovery-carts">
            <h3>
              Waiting to ship
              {snapshot.shipQueue.length > 0 && (
                <span className="recovery-muted"> · {snapshot.shipQueue.length} order{snapshot.shipQueue.length === 1 ? "" : "s"}</span>
              )}
              {overdue.length > 0 && <span className="ops-overdue-badge"> {overdue.length} overdue</span>}
            </h3>
            {snapshot.shipQueueUnavailable && (
              <p className="recovery-muted">Couldn't read open orders right now.</p>
            )}
            {!snapshot.shipQueueUnavailable && snapshot.shipQueue.length === 0 && (
              <p className="recovery-muted">Nothing waiting — every order is shipped. Clean desk.</p>
            )}
            {snapshot.shipQueue.map((order) => (
              <ShipRow key={order.name} order={order} currency={snapshot.currency} />
            ))}
          </section>

          <section className="recovery-carts">
            <h3>Inventory watch</h3>
            {snapshot.inventory.unavailable && (
              <p className="recovery-muted">Couldn't read inventory right now.</p>
            )}
            {!snapshot.inventory.unavailable && (
              <>
                {snapshot.inventory.soldOut.length > 0 && (
                  <>
                    <p className="ops-inventory-head ops-soldout">
                      Sold out — losing sales until restocked
                    </p>
                    {snapshot.inventory.soldOut.map((p) => (
                      <InventoryRow key={p.title} product={p} kind="soldout" />
                    ))}
                  </>
                )}
                {snapshot.inventory.lowStock.length > 0 && (
                  <>
                    <p className="ops-inventory-head">Running low — restock before they sell out</p>
                    {snapshot.inventory.lowStock.map((p) => (
                      <InventoryRow key={p.title} product={p} kind="low" />
                    ))}
                  </>
                )}
                {snapshot.inventory.soldOut.length === 0 && snapshot.inventory.lowStock.length === 0 && (
                  <p className="recovery-muted">
                    All {snapshot.inventory.checked} active products are in stock. Nothing to worry about.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </aside>
  );
}

function ShipRow({ order, currency }: { order: ShipQueueOrder; currency: string | null }) {
  const isOverdue = hoursSince(order.createdAt) >= OVERDUE_HOURS;
  const itemsLine = order.items.map((i) => (i.qty > 1 ? `${i.qty}× ${i.title}` : i.title)).join(", ");
  return (
    <div className={`recovery-cart ops-ship-row${isOverdue ? " ops-overdue" : ""}`}>
      <div className="recovery-cart-head">
        <span className="recovery-cart-who">
          <strong>{order.name}</strong>{" "}
          <span className="recovery-muted">
            {order.financialStatus === "PAID" ? "paid" : order.financialStatus.toLowerCase()}
          </span>
        </span>
        <span className="recovery-cart-meta">
          {formatMoney(order.totalPrice, currency)} · waiting {waitingLabel(order.createdAt)}
          {isOverdue ? " ⚠" : ""}
        </span>
      </div>
      <p className="recovery-cart-items">{itemsLine || "(no items listed)"}</p>
    </div>
  );
}

function InventoryRow({ product, kind }: { product: InventoryProduct; kind: "soldout" | "low" }) {
  const lowVariants = product.variants.filter((v) => v.tracked && v.qty > 0 && v.qty <= 5);
  const detail =
    kind === "low" && lowVariants.length > 0 && product.variants.length > 1
      ? lowVariants.map((v) => `${v.title || "default"}: ${v.qty} left`).join(", ")
      : "";
  return (
    <div className="recovery-cart">
      <div className="recovery-cart-head">
        <span className="recovery-cart-who">
          <strong>{product.title}</strong>
        </span>
        <span className="recovery-cart-meta">
          {kind === "soldout" ? "0 in stock" : `${product.totalInventory} left`}
        </span>
      </div>
      {detail && <p className="recovery-cart-items">{detail}</p>}
    </div>
  );
}
