/**
 * App-level live notifications: subscribes to the store-event stream and
 * shows popup toasts wherever the owner is in the app — plus a browser
 * notification when the tab is hidden (if the owner granted permission via
 * the Ops panel). Mounted once, whenever a store is connected.
 */
import { useEffect, useState } from "react";
import { supabase } from "../lib/auth";
import { subscribeToEvents, type StoreEvent } from "../lib/events";

const TOAST_MS = 7_000;
const MAX_TOASTS = 4;

function icon(type: string): string {
  if (type === "order.new") return "🛒";
  if (type === "stock.out") return "⛔";
  if (type === "stock.low") return "⚠️";
  return "🔔";
}

export function LiveToasts() {
  const [toasts, setToasts] = useState<StoreEvent[]>([]);

  useEffect(() => {
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
          setToasts((cur) => [event, ...cur].slice(0, MAX_TOASTS));
          window.setTimeout(() => {
            setToasts((cur) => cur.filter((t) => t.id !== event.id));
          }, TOAST_MS);
          // Tab in the background → also raise a system notification.
          if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification("Evolution — your store", { body: event.title, tag: event.id });
            } catch {
              /* some platforms restrict constructor use — toast already shown */
            }
          }
        },
        "store-events-toasts",
      );
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="ops-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ops-toast ops-toast-${t.type.replace(".", "-")}`}>
          <span className="ops-toast-icon" aria-hidden="true">
            {icon(t.type)}
          </span>
          <span>{t.title}</span>
          <button
            type="button"
            className="link"
            aria-label="Dismiss"
            onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
