import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/auth';
import { agentTypeForJob, formatMonthlyBudget as money, requestSummary } from './labels';
import { requestContacts, validateContacts, type ContactFields } from './contacts';
import { exampleRequests } from './examples';
import './style.css';

type Account = { id: string; name: string; email: string; role: 'business' | 'developer'; job_notifications: boolean };
type Job = ContactFields & { id: string; business_id: string; requester_name?: string | null; title: string; description: string; frequency: string | null; monthly_budget: number | null; status: string; created_at: string; example?: boolean };
type Action = 'board' | 'join' | 'post' | 'apply' | 'login' | 'admin' | 'alerts';
const validActions = ['join', 'post', 'apply', 'login', 'admin', 'alerts'];
const initialAction = () => {
  const action = new URLSearchParams(location.search).get('action') || '';
  return (location.pathname === '/owner-analytics' ? 'admin' : validActions.includes(action) ? action : 'board') as Action;
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';

function App() {
  const [action, setAction] = useState<Action>(initialAction);
  const [jobId, setJobId] = useState(new URLSearchParams(location.search).get('job') || '');
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [admin, setAdmin] = useState(false);
  const [adminData, setAdminData] = useState<Record<string, unknown>[][]>([]);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    try { return JSON.parse(sessionStorage.getItem('evolution:job-draft') || '{}'); } catch { return {}; }
  });
  const [light, setLight] = useState(() => { try { return localStorage.getItem('evolution:theme:v1') === 'light'; } catch { return false; } });
  const visibleRequests: Job[] = [...jobs.filter(item => item.status === 'Open'), ...exampleRequests];
  const job: Job | undefined = jobs.find(item => item.id === jobId) || exampleRequests.find(item => item.id === jobId);
  const contacts = requestContacts(job || {});

  function navigate(next: Action, target = '') {
    const query = new URLSearchParams();
    if (next !== 'board') query.set('action', next);
    if (target) query.set('job', target);
    history.pushState(null, '', `/${query.size ? `?${query}` : ''}${next === 'apply' ? '#request-contact' : ''}`);
    setAction(next); setJobId(target); setError(''); setNotice(''); window.scrollTo(0, 0);
  }
  useEffect(() => {
    const back = () => { setAction(initialAction()); setJobId(new URLSearchParams(location.search).get('job') || ''); setError(''); };
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    try { localStorage.setItem('evolution:theme:v1', light ? 'light' : 'dark'); } catch {}
  }, [light]);
  async function loadJobs() {
    if (!supabase) { setError('Agent requests are not configured.'); setLoading(false); return; }
    const { data, error: problem } = await supabase.from('evolution_jobs').select('*').order('created_at', { ascending: false });
    if (problem) setError('Agent requests are temporarily unavailable. Please try again shortly.');
    else setJobs(data || []);
    setLoading(false);
  }
  useEffect(() => { void loadJobs(); }, []);
  useEffect(() => {
    if (action !== 'apply' || loading || !contacts.length) return;
    const frame = requestAnimationFrame(() => document.getElementById('request-contact')?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [action, jobId, loading, contacts.length]);
  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: problem }) => {
      if (!active) return;
      if (problem) setError(problem.message);
      setUser(data.session?.user || null); setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (active) { setUser(session?.user || null); setAuthReady(true); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    setAccount(null); setAdmin(false); setApplied([]); setAdminData([]);
    if (!supabase || !user) return;
    const client = supabase;
    void (async () => {
      const response = await client.from('evolution_users').select('*').eq('id', user.id).maybeSingle();
      if (!active) return;
      if (response.error) { setError(response.error.message); return; }
      let profile = response.data as Account | null;
      if (!profile && user.user_metadata.evolution_role === 'developer' && user.user_metadata.evolution_name) {
        const registration = await client.rpc('evolution_register', { display_name: user.user_metadata.evolution_name, account_role: 'developer' });
        if (registration.error) { setError(registration.error.message); return; }
        profile = registration.data as Account;
        if (active) setNotice('You’re registered. New agent requests will arrive by email.');
      }
      const [permission, applications] = await Promise.all([
        client.rpc('evolution_is_admin'),
        client.from('evolution_applications').select('job_id').eq('developer_id', user.id),
      ]);
      if (active) { setAccount(profile); setAdmin(permission.data === true); setApplied((applications.data || []).map(item => item.job_id)); }
    })().catch(problem => { if (active) setError(errorMessage(problem)); });
    return () => { active = false; };
  }, [user]);

  async function notify(test = false) {
    const { data } = await supabase!.auth.getSession();
    try {
      const response = await fetch(`/api/job-notifications${test ? '?test=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token}` } });
      if (test) {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Email delivery check failed.');
        setNotice('Email provider accepted the test message to your owner email. Check your inbox; acceptance is not proof of inbox delivery.');
      }
      return response.ok && response.headers.get('content-type')?.includes('application/json');
    } catch (problem) { if (test) setError(errorMessage(problem)); return false; }
  }
  async function login(email: string, role?: string, name?: string) {
    const query = new URLSearchParams(location.search);
    const { error: problem } = await supabase!.auth.signInWithOtp({ email, options: {
      emailRedirectTo: `${location.origin}/?${query}`,
      shouldCreateUser: action !== 'login',
      ...(role ? { data: { evolution_role: role, evolution_name: name } } : {}),
    } });
    if (problem) throw problem;
    setNotice('Check your email for a sign-in link. Open it to verify and continue.');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      if (!supabase) throw new Error('Email login is not configured.');
      if (action === 'login') { await login(data.email); return; }
      if (action === 'join' || (action === 'apply' && !account)) {
        if (!user) { await login(data.email, 'developer', data.name); return; }
        const { data: profile, error: problem } = await supabase.rpc('evolution_register', { display_name: data.name || user.email?.split('@')[0], account_role: 'developer' });
        if (problem) throw problem;
        setAccount(profile as Account); setNotice('You’re registered for agent request emails.');
        return;
      }
      if (action === 'post') {
        Object.assign(data, validateContacts(data));
        setDraft(data); try { sessionStorage.setItem('evolution:job-draft', JSON.stringify(data)); } catch {}
        if (!user) { await login(data.email, 'business', data.requester_name); return; }
        if (!account) {
          const { data: profile, error: problem } = await supabase.rpc('evolution_register', { display_name: data.requester_name, account_role: 'business' });
          if (problem) throw problem;
          setAccount(profile as Account);
        }
        const { error: problem } = await supabase.rpc('evolution_post_job', { draft: { ...data, budget: Number(data.budget) } });
        if (problem) throw problem;
        setDraft({}); try { sessionStorage.removeItem('evolution:job-draft'); } catch {}
        await loadJobs(); navigate('board');
        const accepted = await notify();
        setNotice(accepted ? 'Your agent request is live. Email notifications are being processed.' : 'Your agent request is live. Email notifications are queued; delivery is not yet confirmed.');
        return;
      }
      if (action === 'apply') {
        const { error: problem } = await supabase.rpc('evolution_apply', { target_job: jobId, proposal_text: data.proposal });
        if (problem) throw problem;
        setApplied(previous => [...previous, jobId]);
        const accepted = await notify();
        setNotice(accepted ? 'Response sent. The business will receive your proposal and email address.' : 'Response saved. The email is queued; delivery is not yet confirmed.');
      }
      if (action === 'alerts') {
        const { error: problem } = await supabase.rpc('evolution_set_alerts', { enabled: data.enabled === 'on' });
        if (problem) throw problem;
        setAccount(previous => previous ? { ...previous, job_notifications: data.enabled === 'on' } : previous);
        setNotice('Request email preference saved.');
      }
    } catch (problem) { setError(errorMessage(problem)); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (action !== 'admin' || !admin || !supabase) return;
    void Promise.all(['evolution_users', 'evolution_jobs', 'evolution_applications'].map(table => supabase!.from(table).select('*').order('created_at', { ascending: false }).limit(1000))).then(results => {
      if (results.some(result => result.error)) setError('Could not load admin records.');
      else setAdminData(results.map(result => result.data || []));
    });
  }, [action, admin]);
  const wrongRole = account && ((action === 'post' && account.role !== 'business') || ((action === 'apply' || action === 'join') && account.role !== 'developer'));
  const formTitle = action === 'join' ? 'Offer an Agent' : action === 'post' ? 'Request an Agent' : action === 'apply' ? 'Agent request' : action === 'alerts' ? 'Request emails' : 'Login with Email';
  return <div className="job-shell">
    <header className="site-header"><a className="brand" href="/" onClick={event => { event.preventDefault(); navigate('board'); }}><img src="/favicon.svg" width="40" height="40" alt=""/>Evolution<span>.</span></a>
      <div className="header-actions"><button className="text-button" onClick={() => setLight(!light)} aria-label={light ? 'Use dark mode' : 'Use light mode'}>{light ? 'Dark' : 'Light'}</button>{user ? <><span className="account-label">{account?.name || user.email}</span><button className="text-button" onClick={() => { void supabase?.auth.signOut(); navigate('board'); }}>Log out</button></> : <button className="text-button" onClick={() => navigate('login')}>Login with Email</button>}</div>
    </header>
    <main>
      {action === 'board' ? <>
        <section className="hero"><h1>Hire AI Agents.<br/><span>Get Work Done.</span></h1><p>AI agents for your recurring work.</p><div className="hero-actions"><button className="primary" onClick={() => navigate('post')}>Request an Agent</button><button className="secondary" onClick={() => navigate('join')}>Offer an Agent</button></div></section>
        <section aria-labelledby="board-heading" className="board"><div className="section-heading"><h2 id="board-heading">Agent requests</h2></div>
          {loading ? <p role="status">Loading requests…</p> : visibleRequests.map(item => <article className="job-card" key={item.id}>
            <div className="job-card-top"><span className="job-badge">{agentTypeForJob(item.title)}</span><strong className={item.monthly_budget === null ? 'budget budget-unset' : 'budget'}>{money(item.monthly_budget)}</strong></div>
            <div className="request-identity"><span className="request-avatar" aria-hidden="true">{(item.requester_name || 'Requester').split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span><div><strong>{item.requester_name || 'Requester'}</strong>{item.example ? <small>Illustrative scope and budget · Not a live request</small> : <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time>}</div></div>
            <h3>{item.title}</h3><p className="job-description">{requestSummary(item.description)}</p>
            <div className="job-card-bottom request-card-actions"><div className="job-buttons">{user?.id === item.business_id && !item.example ? <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); const result = await supabase!.rpc('evolution_close_job', { target_job: item.id }); if (result.error) setError(result.error.message); else await loadJobs(); setBusy(false); }}>Close request</button> : <button className="primary compact" disabled={applied.includes(item.id) && !requestContacts(item).length} onClick={() => navigate('apply', item.id)}>{item.example ? 'View brief' : applied.includes(item.id) && !requestContacts(item).length ? 'Response sent' : 'Respond'} <span aria-hidden="true">↗</span></button>}</div></div>
          </article>)}
          {!loading && !error && !visibleRequests.length && <div className="empty"><h3>What would you like done?</h3><p>Request an AI agent for a recurring task.</p><button className="primary" onClick={() => navigate('post')}>Request an Agent</button></div>}
        </section>
      </> : action === 'admin' ? <section className="form-page admin-page"><button className="text-button back" onClick={() => navigate('board')}>← Agent requests</button><h1>Admin</h1>{!user ? <button className="primary" onClick={() => navigate('login')}>Login with Email</button> : !admin ? <p>Owner access required.</p> : <><button className="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); setNotice(''); await notify(true); setBusy(false); }}>Send test email to me</button>{adminData.map((rows, index) => <section key={index}><h2>{['Users', 'Requests', 'Responses'][index]} ({rows.length})</h2><div className="admin-table"><table><thead><tr>{Object.keys(rows[0] || {}).map(key => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{Object.values(row).map((value, cellIndex) => <td key={cellIndex}>{String(value ?? 'Not specified')}</td>)}</tr>)}</tbody></table></div></section>)}</>}</section> : <section className="form-page"><button className="text-button back" onClick={() => navigate('board')}>← Agent requests</button><div className="eyebrow">EVOLUTION</div><h1>{formTitle}</h1>
        {action === 'apply' && job && <div className="application-job"><div className="job-card-top"><span className="job-badge">{agentTypeForJob(job.title)}</span><strong className={job.monthly_budget === null ? 'budget budget-unset' : 'budget'}>{money(job.monthly_budget)}</strong></div><div className="request-identity"><span className="request-avatar" aria-hidden="true">{(job.requester_name || 'Requester').split(/\s+/).slice(0, 2).map(part => part[0]).join('')}</span><div><strong>{job.requester_name || 'Requester'}</strong>{job.example ? <small>Illustrative scope and budget · Not a live request</small> : <time dateTime={job.created_at}>{new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time>}</div></div><h2>{job.title}</h2><p>{job.description}</p>{job.status === 'Open' && contacts.length > 0 && <section className="request-contact" id="request-contact" aria-labelledby="contact-heading"><h2 id="contact-heading">Contact {job.requester_name || 'the requester'}</h2><div className="contact-actions">{contacts.map(contact => <a key={contact.kind} className="secondary" href={contact.href} target={contact.external ? '_blank' : undefined} rel={contact.external ? 'noopener noreferrer nofollow ugc' : undefined}>{contact.label} <span aria-hidden="true">↗</span></a>)}</div><small>Choose a contact method to discuss this outcome directly.</small></section>}</div>}
        {action === 'apply' && job?.example ? <button className="primary full" onClick={() => { setDraft({ title: job.title, description: job.description, frequency: job.frequency || '', budget: String(job.monthly_budget || '') }); navigate('post'); }}>Use this brief</button> : action === 'apply' && job?.status === 'Open' && contacts.length > 0 ? null : !authReady ? <p>Checking login…</p> : action === 'login' && user ? <><p>You’re signed in as {user.email}.</p><button className="primary full" onClick={() => navigate('board')}>Continue to requests</button></> : wrongRole ? <p>This account is registered as {account?.role === 'developer' ? 'an agent builder' : 'a business'}. Log out to use a different account.</p> : action === 'apply' && loading ? <p>Loading request…</p> : action === 'apply' && !job ? <p>This request is unavailable.</p> : action === 'apply' && job?.status !== 'Open' ? <p>This request is closed.</p> : action === 'apply' && applied.includes(jobId) ? <p>Your response is saved. The business can contact you directly by email.</p> : action === 'join' && account?.role === 'developer' ? <p>You’re registered. {account.job_notifications ? 'You’ll receive agent requests by email.' : 'Request emails are turned off.'} <button className="text-button" onClick={() => navigate('alerts')}>Manage request emails</button></p> : <form onSubmit={submit} key={`${action}:${jobId}:${user?.id || 'guest'}`}>
          {(action === 'join' || (action === 'apply' && !account)) && <label>Name<input name="name" autoComplete="name" required minLength={1} maxLength={80} defaultValue={account?.name || user?.user_metadata.evolution_name || ''}/></label>}
          {action === 'post' && <><label>Your public name<input name="requester_name" autoComplete="name" required maxLength={80} defaultValue={draft.requester_name || ''}/></label><label>Request title<input name="title" required minLength={5} maxLength={100} placeholder="Send a daily inventory report" defaultValue={draft.title || ''}/></label><label>Desired outcome<textarea name="description" required minLength={40} maxLength={1200} rows={5} placeholder="What should your agent deliver, and what does a good result look like?" defaultValue={draft.description || ''}/><small>40–1,200 characters. Focus on the result you need.</small></label><div className="form-row"><label>Frequency<select name="frequency" required defaultValue={draft.frequency || ''}><option value="" disabled>Choose frequency</option>{['Daily', 'Weekly', 'Monthly'].map(value => <option key={value}>{value}</option>)}</select></label><label>Monthly budget (USD)<input name="budget" type="number" required min="1" max="1000000" step="0.01" placeholder="100" defaultValue={draft.budget || ''}/></label></div></>}
          {action !== 'alerts' && <label>{action === 'post' ? 'Business email' : 'Email'}<input name="email" type="email" autoComplete="email" required maxLength={254} readOnly={Boolean(user)} value={user ? user.email : undefined} defaultValue={user ? undefined : draft.email || ''}/></label>}
          {action === 'post' && <fieldset className="contact-fields"><legend>Contact links</legend><p>Add at least one. These links and your name will be public; your login email stays private.</p><label>Public contact email (optional)<input name="contact_email" type="email" maxLength={254} placeholder="hello@yourbusiness.com" defaultValue={draft.contact_email || ''}/></label><label>LinkedIn (optional)<input name="contact_linkedin" type="url" maxLength={500} placeholder="https://www.linkedin.com/in/yourname" defaultValue={draft.contact_linkedin || ''}/></label><label>X (optional)<input name="contact_x" type="url" maxLength={500} placeholder="https://x.com/yourname" defaultValue={draft.contact_x || ''}/></label><label>Contact page (optional)<input name="contact_url" type="url" maxLength={500} placeholder="https://yourwebsite.com/contact" defaultValue={draft.contact_url || ''}/></label></fieldset>}
          {action === 'apply' && account?.role === 'developer' && <><label>Your name<input value={account.name} readOnly/></label><label>Your agent’s approach<textarea name="proposal" required minLength={40} maxLength={1000} rows={5} placeholder="How will your agent deliver this outcome, and what does it need to get started?"/><small>40–1,000 characters. Your name, email and proposal go to the business.</small></label></>}
          {action === 'alerts' && (user && account?.role === 'developer' ? <label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={account.job_notifications}/>Email me new agent requests</label> : <p>Log in as an agent builder to manage request emails. <button type="button" className="text-button" onClick={() => navigate('login')}>Login with Email</button></p>)}
          {(action === 'join' || (action === 'apply' && !account)) && <p className="form-hint">Verify your email to receive agent requests and offer your agent. Turn emails off anytime.</p>}
          {action === 'post' && !user && <p className="form-hint">Verify your business email before publishing. Only the contact methods you add above will be public.</p>}
          {!(action === 'alerts' && (!user || account?.role !== 'developer')) && <button className="primary full" disabled={busy || !supabase}>{busy ? 'Please wait…' : action === 'post' ? user ? 'Publish Request' : 'Verify Email to Publish' : action === 'apply' && account ? 'Send Response' : action === 'alerts' ? 'Save preference' : user && action === 'join' ? 'Join as Agent Builder' : 'Send Sign-in Link'}</button>}
        </form>}
      </section>}
      {error && <div role="alert" className="message error">{error}</div>}{notice && <div role="status" className="message success">{notice}</div>}
    </main><footer><span>Evolution connects businesses with AI agents.</span><div><a href="/guides/">Guides</a>{admin && <button className="text-button" onClick={() => navigate('admin')}>Admin</button>}</div></footer>
  </div>;
}

createRoot(document.getElementById('network-root')!).render(<App/>);
