interface Props {
  /** When true the splash fades/scales out; unmount it after the transition. */
  leaving: boolean;
  /** True once everything is loaded (switches the status line to "Ready"). */
  ready: boolean;
}

/**
 * Boot splash — shown while the 3D model streams in and the app warms up, styled
 * after the Evolution landing: a white logo tile with the gradient butterfly, a
 * script wordmark, and a tagline with gradient-highlighted words on a warm glow.
 * Once ready it fades out and hands off to the app's entrance animation.
 */
export function Splash({ leaving, ready }: Props) {
  return (
    <div className={`splash ${leaving ? "leaving" : ""}`} role="status" aria-live="polite">
      <div className="splash-inner">
        <div className="splash-logo">
          <svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id="evoWings" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffc83d" />
                <stop offset="52%" stopColor="#ff8a3d" />
                <stop offset="100%" stopColor="#ff5470" />
              </linearGradient>
            </defs>
            <path
              d="M12 5.5c-1-1.6-2.7-2.6-4.6-2.6C4.9 2.9 3 4.8 3 7.2c0 2.2 1.5 3.6 3.4 4.4C4.4 12 3 13.2 3 15.2c0 2.1 1.7 3.7 3.8 3.7 2.3 0 4.2-1.6 5.2-3.8V5.5z"
              fill="url(#evoWings)"
            />
            <path
              d="M12 5.5c1-1.6 2.7-2.6 4.6-2.6 2.5 0 4.4 1.9 4.4 4.3 0 2.2-1.5 3.6-3.4 4.4 2 .4 3.4 1.6 3.4 3.6 0 2.1-1.7 3.7-3.8 3.7-2.3 0-4.2-1.6-5.2-3.8V5.5z"
              fill="url(#evoWings)"
              opacity="0.78"
            />
            <circle cx="12" cy="4.4" r="1.5" fill="url(#evoWings)" />
          </svg>
        </div>

        <h1 className="splash-word">Evolution</h1>
        <p className="splash-tag">
          The <span className="hl">AI copilot</span> for ecommerce founders.
        </p>

        <div className="splash-loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="splash-status">{ready ? "Ready" : "Warming up…"}</p>
      </div>
    </div>
  );
}
