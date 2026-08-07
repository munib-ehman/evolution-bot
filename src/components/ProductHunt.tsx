/**
 * The free tier's product hunt — live web research, rendered as three
 * evidence-backed product cards: why it's winning (with stats), where to
 * source it, and a ready-to-paste listing with a copy button.
 *
 * The run streams SSE progress lines (the research pass takes ~30-60s);
 * the last saved report loads from Supabase so the card is never empty on
 * return visits.
 */
import { useEffect, useState } from "react";
import {
  getLatestHunt,
  runProductHunt,
  type HuntProduct,
  type HuntReport,
} from "../lib/hunt";

function listingText(p: HuntProduct): string {
  return [
    p.listing.title,
    "",
    `Price: ${p.listing.price}`,
    "",
    ...p.listing.bullets.map((b) => `• ${b}`),
    "",
    p.listing.description,
  ].join("\n");
}

export function ProductHunt({ storeUrl }: { storeUrl: string | null }) {
  const [report, setReport] = useState<HuntReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    if (storeUrl) {
      void getLatestHunt(storeUrl).then((saved) => {
        if (active) setReport(saved);
      });
    }
    return () => {
      active = false;
    };
  }, [storeUrl]);

  const run = async () => {
    if (!storeUrl || busy) return;
    setBusy(true);
    setError(null);
    setProgress("Starting the hunt…");
    try {
      const { report: fresh, error: err } = await runProductHunt(storeUrl, setProgress);
      if (fresh) setReport(fresh);
      else setError(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const copyListing = async (p: HuntProduct) => {
    try {
      await navigator.clipboard.writeText(listingText(p));
      setCopied(p.name);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked — the text is on screen anyway */
    }
  };

  return (
    <section className="card free-card">
      <div className="free-card-head">
        <h3>Product hunt</h3>
        <span className="tier-badge free">Included free</span>
      </div>

      {!report && (
        <p className="free-card-body">
          {storeUrl
            ? "Three winning products for your niche, researched from live market data — with real sourcing, unit costs, and ready-to-paste listings."
            : "Connect your store first — the hunt reads your catalog to pin down your niche, then researches the live market for it."}
        </p>
      )}

      {report && (
        <>
          <p className="free-card-body">{report.summary}</p>
          <p className="scan-receipts">
            Your niche: {report.niche}
            {report.audience && <> · audience: {report.audience}</>}
            {" · "}hunted {new Date(report.generatedAt).toLocaleDateString()}
          </p>

          {report.products.map((p, i) => (
            <article className="hunt-product" key={p.name}>
              <h4>
                {i + 1}. {p.name}
              </h4>
              {p.hook && <p className="hunt-hook">{p.hook}</p>}
              <p className="hunt-why">{p.whyWinning}</p>

              {p.stats.length > 0 && (
                <div className="stat-grid">
                  {p.stats.map((s) => (
                    <div className="stat" key={s.label}>
                      <span>{s.value}</span>
                      <label>{s.label}</label>
                    </div>
                  ))}
                </div>
              )}

              {p.sourcing.length > 0 && (
                <div className="hunt-block">
                  <strong>Where to source it</strong>
                  <ul>
                    {p.sourcing.map((s) => (
                      <li key={`${s.supplier}-${s.searchTerm}`}>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer">{s.supplier}</a>
                        ) : (
                          s.supplier
                        )}
                        {s.searchTerm && <> — search “{s.searchTerm}”</>}
                        {s.unitCost && <> · unit cost {s.unitCost}</>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(p.listing.title || p.listing.description) && (
                <details className="hunt-listing">
                  <summary>Ready-to-paste listing</summary>
                  <p className="hunt-listing-title">
                    <strong>{p.listing.title}</strong>
                    {p.listing.price && <> · {p.listing.price}</>}
                  </p>
                  {p.listing.bullets.length > 0 && (
                    <ul>
                      {p.listing.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  <p>{p.listing.description}</p>
                  <button type="button" className="link" onClick={() => void copyListing(p)}>
                    {copied === p.name ? "✓ Copied" : "Copy listing"}
                  </button>
                </details>
              )}

              {p.fit && <p className="hunt-fit">{p.fit}</p>}

              {p.sources.length > 0 && (
                <p className="hunt-sources">
                  Sources:{" "}
                  {p.sources.map((s, j) => (
                    <span key={s.url}>
                      {j > 0 && " · "}
                      <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                    </span>
                  ))}
                </p>
              )}
            </article>
          ))}
        </>
      )}

      {storeUrl && (
        <button type="button" className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Hunting…" : report ? "Hunt again" : "Hunt winning products"}
        </button>
      )}
      {busy && progress && <p className="hunt-progress" role="status" aria-live="polite">{progress}</p>}
      {error && <p className="overlay-error">{error}</p>}
    </section>
  );
}
