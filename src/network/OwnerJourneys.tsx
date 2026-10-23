import { useEffect, useState } from 'react';
import { supabase } from '../lib/auth';

type Person = {
  id: string; name: string; email: string; joined_at: string; last_active: string | null;
  clicks_made: number; clicks_received: number;
  posts: { id: string; kind: string; title: string; created_at: string; views: number; clicks: number }[];
  journey: { id: string; at: string; action: string; target: string | null; target_owner: string | null }[];
};
type Report = { generated_at: string; reset_at: string | null; users: Person[]; anonymous_interactions: number };
const time = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });

export function OwnerJourneys() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError('');
    try {
      if (!supabase) throw new Error('Shared analytics are not configured.');
      const { data, error: failure } = await supabase.rpc('network_owner_journeys');
      if (failure) throw new Error('Could not load user journeys. Check owner access and the database update.');
      setReport(data as Report);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load analytics.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const people = report?.users.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <>
    <div className="owner-tools"><label>Find a user<input type="search" placeholder="Name or email" value={search} onChange={event => setSearch(event.target.value)}/></label><button className="post-button" disabled={busy} onClick={() => { void refresh(); }}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    <p className="composer-note">Times in Pakistan. Views and clicks include only opted-in activity. Clicks do not confirm a hire. Anonymous activity cannot reliably be assigned to a person.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {report && <p className="report-scope">{report.users.length} users · {report.anonymous_interactions} anonymous interactions · Updated {time(report.generated_at)}{report.reset_at && <> · Tracking reset {time(report.reset_at)}</>}</p>}
    {people.map(person => <details className="person-card" key={person.id}>
      <summary><div><strong>{person.name}</strong><span>{person.email}</span></div><span>{person.posts.length} posts · {person.clicks_made} clicks made · {person.clicks_received} received</span></summary>
      <p className="composer-note">Joined {time(person.joined_at)} · Last tracked activity: {person.last_active ? time(person.last_active) : 'None yet'}</p>
      <h2>Posts and requests</h2>
      {person.posts.length === 0 ? <p>No posts yet.</p> : <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Post</th><th>Type</th><th>Views</th><th>Clicks</th><th>Posted</th></tr></thead><tbody>{person.posts.map(post => <tr key={post.id}><td>{post.title}</td><td>{post.kind === 'request' ? 'Request' : 'Agent'}</td><td>{post.views}</td><td>{post.clicks}</td><td>{time(post.created_at)}</td></tr>)}</tbody></table></div>}
      <h2>Usage journey</h2>
      <ol className="person-journey">{person.journey.map(activity => <li key={activity.id}><time dateTime={activity.at}>{time(activity.at)}</time><div><strong>{activity.action}</strong>{activity.target && <span>{activity.target}{activity.target_owner ? ` by ${activity.target_owner}` : ''}</span>}</div></li>)}</ol>
      <p className="composer-note">Latest 100 steps, newest first. Signup and published posts come from saved records, not analytics tracking.</p>
    </details>)}
    {report && people.length === 0 && <p>No matching users.</p>}
  </>;
}
