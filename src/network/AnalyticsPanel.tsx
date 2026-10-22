import { useEffect, useState } from 'react';
import { consent, setConsent, readReport, syncStatus, type Report } from './analytics';

const labels: Record<string, string> = { feed_view: 'Feed visits', post_view: 'Post views', post_open: 'Post button clicks', form_start: 'Posting started', form_close: 'Composer closed', agent_reuse: 'Agent reused', logo_added: 'Logo added', logo_removed: 'Logo removed', login_request: 'Sign-in requested', login_sent: 'Sign-in email sent', login_error: 'Sign-in error', publish_attempt: 'Publish clicked', publish_success: 'Posts published', publish_error: 'Publish failed', feed_error: 'Feed refresh failed', checkout_click: 'Hire / checkout clicks', response_click: 'Request response clicks' };

labels.login_success = 'Signed in';
labels.login_click = 'Sign-in button clicks';
labels.publish_click = 'Publish button clicks';
labels.publish_attempt = 'Valid publish attempts';
labels.form_validation_error = 'Posting validation errors';
labels.logo_picker_open = 'Logo picker opened';

export function AnalyticsPanel({ onConsent }: { onConsent: (allow: boolean) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [allowed, setAllowed] = useState(consent() === true);
  const [sync, setSync] = useState(syncStatus());
  async function refresh() {
    setError('');
    try { setReport(await readReport()); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analytics unavailable.'); } finally { setSync(syncStatus()); }
  }
  useEffect(() => { void refresh(); }, []);
  return <>
    <p className="composer-note">Opt-in journey analytics uses a random browser/session ID. Signed-in activity is linked to the account ID. No fingerprints, IP addresses, emails, post contents or payment details are collected by this feature.</p>
    <label className="analytics-consent"><input type="checkbox" checked={allowed} onChange={event => { const value = event.target.checked; setConsent(value); setAllowed(value); onConsent(value); void refresh(); }}/>Allow basic usage analytics on this browser</label>
    <p className="composer-note">Turning this off clears locally held analytics IDs/events and stops future collection. Previously synchronized events remain subject to server retention.</p>
    <button className="analytics-refresh" onClick={() => { void refresh(); }}>Refresh analytics</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {sync.shared && (sync.pending > 0 || sync.rejected > 0) && <p className="composer-note">This browser: {sync.pending} events pending synchronization; {sync.rejected} rejected. Shared counts may be incomplete. Refresh retries pending events.</p>}
    {report && <><p className="report-scope">{report.scope} · last 30 days</p><div className="analytics-grid">{['feed_view', 'post_view', 'checkout_click', 'post_open', 'publish_click', 'publish_success'].map(name => <div key={name}><strong>{report.counts.find(row => row.name === name)?.total ?? 0}</strong><span>{labels[name]}</span></div>)}</div>
      <p className="composer-note">Observed activity, not a verified sales funnel. Checkout arrival, payment, task completion and revenue are unknown without integration with the seller’s service. Counts include only opted-in activity.</p>
      <h3 className="analytics-title">Which posts get interest?</h3><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Agent / post</th><th>Views</th><th>Hire clicks</th></tr></thead><tbody>{report.agents.map((row, index) => <tr key={index}><td>{row.agent}</td><td>{row.views}</td><td>{row.clicks}</td></tr>)}</tbody></table></div>
      <h3 className="analytics-title">Journey · latest 100 events</h3><p className="composer-note">Account IDs identify signed-in actors. Visitor IDs identify browsers, not verified people. Hover a visitor to see session and posting-flow IDs.</p><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Who</th><th>Action</th><th>Agent / seller</th><th>When</th></tr></thead><tbody>{report.journey.map(row => <tr key={row.id}><td title={`Identity: ${row.actorId || row.visitorId || row.actor} · Session: ${row.session} · Flow: ${row.flow || 'none'}`}>{row.actor}</td><td>{labels[row.name] || row.name}</td><td>{row.agent || '—'}{row.seller && <small>by {row.seller}</small>}</td><td>{new Date(row.at).toLocaleString()}</td></tr>)}</tbody></table></div>
      <h3 className="analytics-title">Other actions</h3><div className="analytics-table-wrap"><table className="analytics-table"><tbody>{report.counts.filter(row => row.total > 0).map(row => <tr key={row.name}><td>{labels[row.name] || row.name}</td><td>{row.total} events · {row.visitors} browsers</td></tr>)}</tbody></table></div></>}
  </>;
}
