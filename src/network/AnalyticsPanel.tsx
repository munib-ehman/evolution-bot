import { useEffect, useState } from 'react';
import { consent, setConsent, readReport, syncStatus, type Report } from './analytics';
import { supabase } from '../lib/auth';

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
  const owner = report?.scope.startsWith('Private owner view') === true;
  async function refresh() {
    setError('');
    try {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { setReport(null); return; }
      }
      setReport(await readReport());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analytics unavailable.'); } finally { setSync(syncStatus()); }
  }
  useEffect(() => { void refresh(); }, []);
  return <>
    <p className="composer-note">Choose whether to share basic usage activity. Signed-in activity is linked to your account. No payment details or fingerprinting.</p>
    <label className="analytics-consent"><input type="checkbox" checked={allowed} onChange={event => { const value = event.target.checked; setConsent(value); setAllowed(value); onConsent(value); void refresh(); }}/>Allow basic usage analytics on this browser</label>
    <p className="composer-note">Turn off to stop tracking and clear local activity. Previously saved server activity follows our retention policy.</p>
    {report && <button className="analytics-refresh" onClick={() => { void refresh(); }}>Refresh stats</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {owner && sync.shared && (sync.pending > 0 || sync.rejected > 0) && <p className="composer-note">This browser: {sync.pending} events pending synchronization; {sync.rejected} rejected. Shared counts may be incomplete. Refresh retries pending events.</p>}
    {report && <><p className="report-scope">{owner ? 'Platform analytics' : 'Your activity'} · last 30 days</p><div className="analytics-grid">{(owner ? ['feed_view', 'post_view', 'checkout_click', 'response_click', 'post_open', 'publish_success'] : ['post_view', 'checkout_click', 'response_click']).map(name => <div key={name}><strong>{report.counts.find(row => row.name === name)?.total ?? 0}</strong><span>{labels[name]}</span></div>)}</div>
      <p className="composer-note">Opted-in activity only. Clicks are not confirmed hires or payments.</p>
      <h3 className="analytics-title">Which posts get interest?</h3><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Agent / post</th><th>Views</th><th>Hire clicks</th></tr></thead><tbody>{report.agents.map((row, index) => <tr key={index}><td>{row.agent}</td><td>{row.views}</td><td>{row.clicks}</td></tr>)}</tbody></table></div>
      {owner && <><h3 className="analytics-title">Journey · latest 100 events</h3><p className="composer-note">Account IDs identify signed-in actors. Visitor IDs identify browsers, not verified people. Hover a visitor to see session and posting-flow IDs.</p><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Who</th><th>Action</th><th>Agent / seller</th><th>When</th></tr></thead><tbody>{report.journey.map(row => <tr key={row.id}><td title={`Identity: ${row.actorId || row.visitorId || row.actor} · Session: ${row.session} · Flow: ${row.flow || 'none'}`}>{row.actor}</td><td>{labels[row.name] || row.name}</td><td>{row.agent || 'Not linked'}{row.seller && <small>by {row.seller}</small>}</td><td>{new Date(row.at).toLocaleString()}</td></tr>)}</tbody></table></div>
      <h3 className="analytics-title">Other actions</h3><div className="analytics-table-wrap"><table className="analytics-table"><tbody>{report.counts.filter(row => row.total > 0).map(row => <tr key={row.name}><td>{labels[row.name] || row.name}</td><td>{row.total} events · {row.visitors} browsers</td></tr>)}</tbody></table></div></>}</>}
  </>;
}
