import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/auth';
import './style.css';

type Account = { id: string; name: string; email: string; role: 'business' | 'developer'; job_notifications: boolean };
type Job = { id: string; business_id: string; title: string; description: string; frequency: string | null; monthly_budget: number | null; status: string; created_at: string };
type Action = 'board' | 'join' | 'post' | 'apply' | 'login' | 'admin' | 'alerts';
const validActions = ['join', 'post', 'apply', 'login', 'admin', 'alerts'];
const initialAction = () => {
  const action = new URLSearchParams(location.search).get('action') || '';
  return (location.pathname === '/owner-analytics' ? 'admin' : validActions.includes(action) ? action : 'board') as Action;
};
const money = (amount: number | null) => amount === null ? 'Monthly budget not specified' : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)}/month`;
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
  const job = jobs.find(item => item.id === jobId);

  function navigate(next: Action, target = '') {
    const query = new URLSearchParams();
    if (next !== 'board') query.set('action', next);
    if (target) query.set('job', target);
    history.pushState(null, '', `/${query.size ? `?${query}` : ''}`);
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
    if (!supabase) { setError('Shared job board is not configured.'); setLoading(false); return; }
    const { data, error: problem } = await supabase.from('evolution_jobs').select('*').order('created_at', { ascending: false });
    if (problem) setError('The job board is temporarily unavailable. Please try again shortly.');
    else setJobs(data || []);
    setLoading(false);
  }
  useEffect(() => { void loadJobs(); }, []);
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
        if (active) setNotice('You’re registered. New jobs will arrive by email.');
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
        setAccount(profile as Account); setNotice('You’re registered for new-job emails.');
        return;
      }
      if (action === 'post') {
        setDraft(data); try { sessionStorage.setItem('evolution:job-draft', JSON.stringify(data)); } catch {}
        if (!user) { await login(data.email, 'business', data.email.split('@')[0]); return; }
        if (!account) {
          const { data: profile, error: problem } = await supabase.rpc('evolution_register', { display_name: user.email?.split('@')[0], account_role: 'business' });
          if (problem) throw problem;
          setAccount(profile as Account);
        }
        const { error: problem } = await supabase.rpc('evolution_post_job', { draft: { ...data, budget: Number(data.budget) } });
        if (problem) throw problem;
        setDraft({}); try { sessionStorage.removeItem('evolution:job-draft'); } catch {}
        await loadJobs(); navigate('board');
        const accepted = await notify();
        setNotice(accepted ? 'Your job is live. Developer notifications are being processed.' : 'Your job is live. Email notifications are queued; delivery is not yet confirmed.');
        return;
      }
      if (action === 'apply') {
        const { error: problem } = await supabase.rpc('evolution_apply', { target_job: jobId, proposal_text: data.proposal });
        if (problem) throw problem;
        setApplied(previous => [...previous, jobId]);
        const accepted = await notify();
        setNotice(accepted ? 'Application submitted. The business will receive your proposal and email address.' : 'Application saved. The email is queued; delivery is not yet confirmed.');
      }
      if (action === 'alerts') {
        const { error: problem } = await supabase.rpc('evolution_set_alerts', { enabled: data.enabled === 'on' });
        if (problem) throw problem;
        setAccount(previous => previous ? { ...previous, job_notifications: data.enabled === 'on' } : previous);
        setNotice('Job email preference saved.');
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
  const formTitle = action === 'join' ? 'Join as Developer' : action === 'post' ? 'Post a Job' : action === 'apply' ? 'Apply for Job' : action === 'alerts' ? 'Job emails' : 'Login with Email';
  return <div className="job-shell">
    <header className="site-header"><a className="brand" href="/" onClick={event => { event.preventDefault(); navigate('board'); }}><img src="/favicon.svg" width="40" height="40" alt=""/>Evolution<span>.</span></a>
      <div className="header-actions"><button className="text-button" onClick={() => setLight(!light)} aria-label={light ? 'Use dark mode' : 'Use light mode'}>{light ? 'Dark' : 'Light'}</button>{user ? <><span className="account-label">{account?.name || user.email}</span><button className="text-button" onClick={() => { void supabase?.auth.signOut(); navigate('board'); }}>Log out</button></> : <button className="text-button" onClick={() => navigate('login')}>Login with Email</button>}</div>
    </header>
    <main>
      {action === 'board' ? <>
        <section className="hero"><div className="eyebrow">THE JOB BOARD FOR AI AGENTS</div><h1>Hire AI Agents.<br/><span>Get Work Done.</span></h1><p>Find AI developers to automate your recurring business tasks.</p><div className="hero-actions"><button className="primary" onClick={() => navigate('post')}>Post a Job <span aria-hidden="true">↗</span></button><button className="secondary" onClick={() => navigate('join')}>Join as Developer</button></div><small>Post the outcome. Connect by email. Work directly together.</small></section>
        <section aria-labelledby="board-heading" className="board"><div className="section-heading"><h2 id="board-heading">Open jobs</h2><span>Recurring work. Real outcomes.</span></div>
          {loading ? <p role="status">Loading jobs…</p> : jobs.filter(item => item.status === 'Open').map(item => <article className="job-card" key={item.id}>
            <div className="job-card-top"><span className="job-badge">AI AGENT WANTED</span><strong className="budget">{money(item.monthly_budget)}</strong></div><h3>{item.title}</h3><p className="job-description">{item.description}</p><div className="job-card-bottom"><div className="job-meta"><span>{item.frequency || 'Frequency not specified'}</span><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time></div><div className="job-buttons">{user?.id === item.business_id ? <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); const result = await supabase!.rpc('evolution_close_job', { target_job: item.id }); if (result.error) setError(result.error.message); else await loadJobs(); setBusy(false); }}>Close job</button> : <button className="primary compact" disabled={applied.includes(item.id)} onClick={() => navigate('apply', item.id)}>{applied.includes(item.id) ? 'Applied' : 'Apply'} <span aria-hidden="true">↗</span></button>}</div></div>
          </article>)}
          {!loading && !error && !jobs.some(item => item.status === 'Open') && <div className="empty"><h3>What would you like done?</h3><p>Post a recurring task for an AI developer.</p><button className="primary" onClick={() => navigate('post')}>Post a Job</button></div>}
        </section>
      </> : action === 'admin' ? <section className="form-page admin-page"><button className="text-button back" onClick={() => navigate('board')}>← Job board</button><h1>Admin</h1>{!user ? <button className="primary" onClick={() => navigate('login')}>Login with Email</button> : !admin ? <p>Owner access required.</p> : <><button className="secondary" disabled={busy} onClick={async () => { setBusy(true); setError(''); setNotice(''); await notify(true); setBusy(false); }}>Send test email to me</button>{adminData.map((rows, index) => <section key={index}><h2>{['Users', 'Jobs', 'Applications'][index]} ({rows.length})</h2><div className="admin-table"><table><thead><tr>{Object.keys(rows[0] || {}).map(key => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{Object.values(row).map((value, cellIndex) => <td key={cellIndex}>{String(value ?? 'Not specified')}</td>)}</tr>)}</tbody></table></div></section>)}</>}</section> : <section className="form-page"><button className="text-button back" onClick={() => navigate('board')}>← Job board</button><div className="eyebrow">EVOLUTION</div><h1>{formTitle}</h1>
        {action === 'apply' && job && <div className="application-job"><h2>{job.title}</h2><strong>{money(job.monthly_budget)}</strong><p>{job.description}</p><span>{job.frequency || 'Frequency not specified'}</span></div>}
        {!authReady ? <p>Checking login…</p> : action === 'login' && user ? <><p>You’re signed in as {user.email}.</p><button className="primary full" onClick={() => navigate('board')}>Continue to jobs</button></> : wrongRole ? <p>This account is registered as a {account?.role}. Log out to use a different account.</p> : action === 'apply' && loading ? <p>Loading job…</p> : action === 'apply' && !job ? <p>This job is unavailable.</p> : action === 'apply' && job?.status !== 'Open' ? <p>This job is closed.</p> : action === 'apply' && applied.includes(jobId) ? <p>You have applied. The business can contact you directly by email.</p> : action === 'join' && account?.role === 'developer' ? <p>You’re registered. {account.job_notifications ? 'You’ll receive new jobs by email.' : 'New-job emails are turned off.'} <button className="text-button" onClick={() => navigate('alerts')}>Manage job emails</button></p> : <form onSubmit={submit} key={`${action}:${jobId}:${user?.id || 'guest'}`}>
          {(action === 'join' || (action === 'apply' && !account)) && <label>Name<input name="name" autoComplete="name" required minLength={1} maxLength={80} defaultValue={account?.name || user?.user_metadata.evolution_name || ''}/></label>}
          {action === 'post' && <><label>Job title<input name="title" required minLength={5} maxLength={100} placeholder="Send a daily shortlist of relevant jobs" defaultValue={draft.title || ''}/></label><label>Job description<textarea name="description" required minLength={40} maxLength={1200} rows={5} placeholder="What outcome do you want, what inputs can you provide, and what should a good result look like?" defaultValue={draft.description || ''}/><small>40–1,200 characters. Focus on the result you need.</small></label><div className="form-row"><label>Frequency<select name="frequency" required defaultValue={draft.frequency || ''}><option value="" disabled>Choose frequency</option>{['Daily', 'Weekly', 'Monthly'].map(value => <option key={value}>{value}</option>)}</select></label><label>Monthly budget (USD)<input name="budget" type="number" required min="1" max="1000000" step="0.01" placeholder="100" defaultValue={draft.budget || ''}/></label></div></>}
          {action !== 'alerts' && <label>{action === 'post' ? 'Business email' : 'Email'}<input name="email" type="email" autoComplete="email" required maxLength={254} readOnly={Boolean(user)} value={user ? user.email : undefined} defaultValue={user ? undefined : draft.email || ''}/></label>}
          {action === 'apply' && account?.role === 'developer' && <><label>Developer name<input value={account.name} readOnly/></label><label>Short proposal<textarea name="proposal" required minLength={40} maxLength={1000} rows={5} placeholder="Explain how you would deliver this outcome and what you need to get started."/><small>40–1,000 characters. Your name, email and proposal go to the business.</small></label></>}
          {action === 'alerts' && (user && account?.role === 'developer' ? <label className="checkbox"><input type="checkbox" name="enabled" defaultChecked={account.job_notifications}/>Email me new jobs</label> : <p>Log in as a developer to manage job emails. <button type="button" className="text-button" onClick={() => navigate('login')}>Login with Email</button></p>)}
          {(action === 'join' || (action === 'apply' && !account)) && <p className="form-hint">After email verification, you’ll be registered for new-job emails. You can turn them off anytime.</p>}
          {action === 'post' && !user && <p className="form-hint">Verify your email before publishing. Your email is not shown on the public board.</p>}
          {!(action === 'alerts' && (!user || account?.role !== 'developer')) && <button className="primary full" disabled={busy || !supabase}>{busy ? 'Please wait…' : action === 'post' ? user ? 'Publish Job' : 'Verify Email to Post' : action === 'apply' && account ? 'Submit Application' : action === 'alerts' ? 'Save preference' : user && action === 'join' ? 'Register as Developer' : 'Send Sign-in Link'}</button>}
        </form>}
      </section>}
      {error && <div role="alert" className="message error">{error}</div>}{notice && <div role="status" className="message success">{notice}</div>}
    </main><footer><span>Evolution connects businesses and developers. You work directly together.</span><div><a href="/guides/">Guides</a>{admin && <button className="text-button" onClick={() => navigate('admin')}>Admin</button>}</div></footer>
  </div>;
}

createRoot(document.getElementById('network-root')!).render(<App/>);
