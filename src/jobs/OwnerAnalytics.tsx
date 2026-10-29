import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/auth';
import { activityLabels } from './analytics';

type Person = { key: string; name: string; email: string | null; role: string | null; last_active: string; interactions: number; contact_clicks: number; requests: number; responses: number };
type Summary = { generated_at: string; period_days: number; users: number; requests: number; responses: number; contact_clicks: number; people: Person[] };
type Entry = { id: string; at: string; action: string; target: string | null; target_owner: string | null; job_id: string | null; session_id: string | null; example_key: string | null };
type Journey = { cutoff: string; has_more: boolean; items: Entry[] };
const when = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function OwnerAnalytics() {
  const [report, setReport] = useState<Summary | null>(null);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  useEffect(() => {
    let active = true;
    setError('');
    void supabase!.rpc('evolution_owner_analytics').then(({ data, error: problem }) => {
      if (!active) return;
      if (problem) { setError('Owner analytics could not be loaded.'); return; }
      const summary = data as Summary;
      setReport(summary);
      setSelected(previous => summary.people.some(person => person.key === previous) ? previous : summary.people[0]?.key || '');
    });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (!selected || !report) return;
    const current = ++version.current;
    setLoading(true); setJourney(null); setError('');
    void supabase!.rpc('evolution_owner_journey', { person_key: selected, cutoff: report.generated_at, page_offset: 0 }).then(({ data, error: problem }) => {
      if (current !== version.current) return;
      setLoading(false);
      if (problem) setError('This journey could not be loaded.'); else setJourney(data as Journey);
    });
    return () => { version.current++; };
  }, [selected, report]);
  async function loadMore() {
    if (!journey || loading) return;
    const current = ++version.current;
    setLoading(true);
    const { data, error: problem } = await supabase!.rpc('evolution_owner_journey', { person_key: selected, cutoff: journey.cutoff, page_offset: journey.items.length });
    if (current !== version.current) return;
    setLoading(false);
    if (problem) setError('More activity could not be loaded.');
    else setJourney(previous => ({ ...(data as Journey), items: [...(previous?.items || []), ...(data as Journey).items] }));
  }
  const person = report?.people.find(item => item.key === selected);
  const people = report?.people.filter(item => `${item.name} ${item.email || ''}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <section className="owner-analytics" aria-labelledby="analytics-title">
    <div className="section-heading"><h2 id="analytics-title">Platform analytics</h2><button className="secondary compact" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    <p className="analytics-note">Private to you. Clicks and navigation cover consenting visitors; account and request records come from the database. Times are Pakistan time.</p>
    {error && <p role="alert" className="message error">{error}</p>}
    {!report ? <p role="status">Loading analytics…</p> : <>
      <div className="analytics-stats">{[[report.users,'Accounts'],[report.requests,'Real requests'],[report.responses,'Responses'],[report.contact_clicks,'Contact clicks · 30 days']].map(([value,label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="journey-layout"><aside className="journey-people" aria-label="People"><label>Find a person<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or email"/></label>{people.map(item => <button className={item.key === selected ? 'person-row selected' : 'person-row'} key={item.key} onClick={() => setSelected(item.key)} aria-pressed={item.key === selected}><strong>{item.name}</strong><span>{item.email || 'Anonymous visitor'}</span><small>{item.interactions} interactions · {item.contact_clicks} contact clicks</small><small>Last active {when(item.last_active)}</small></button>)}{!people.length && <p>No matching people.</p>}</aside>
      <section className="journey-detail" aria-label="Selected user journey">{person ? <><h3>{person.name}</h3><p>{person.email || 'Identity unknown until sign-in'}</p><p className="analytics-note">{person.requests} requests · {person.responses} responses · {person.contact_clicks} contact clicks in the last 30 days. A contact click is not proof of a message or deal.</p>{loading && !journey ? <p role="status">Loading journey…</p> : <><ol className="journey-timeline">{journey?.items.map(entry => <li key={entry.id}><time dateTime={entry.at}>{when(entry.at)}</time><strong>{activityLabels[entry.action] || 'Interaction'}</strong>{entry.target && <span>{entry.target}</span>}{entry.target_owner && <small>Requested by {entry.target_owner}</small>}{entry.example_key && <small>Example brief · {entry.example_key.replace('example-', '#')}</small>}{entry.job_id && <a href={`/?action=apply&job=${encodeURIComponent(entry.job_id)}#request-contact`} target="_blank" rel="noopener noreferrer">View request ↗</a>}</li>)}</ol>{journey && !journey.items.length && <p>No observed activity yet. Earlier untracked browsing cannot be reconstructed.</p>}{journey?.has_more && <button className="secondary" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load earlier activity'}</button>}</>}</> : <p>Select a person to see their journey.</p>}</section></div>
    </>}
  </section>;
}
