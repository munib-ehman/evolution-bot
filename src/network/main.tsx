import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { topics, publicPosts } from './topics.mjs';
import { supabase, sendMagicLink } from '../lib/auth';
import { canHire, reportedHires, recordHireClick, safeAgentUrl, safeLogo, sortedPosts, type AgentPost } from './model.mjs';
import { ownAgents, publishPost, publishRequest, readFeed } from './store';
import { prepareLogo } from './logo';
import { consent, setConsent, setAnalyticsActor, setAnalyticsPosts, track, flushEvents } from './analytics';
import { AnalyticsPanel } from './AnalyticsPanel';
import { OwnerAnalytics } from './OwnerAnalytics';
import './network.css';
import './responsive.css';
import './dark.css';

function Arrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 18 12-12M6 6h12v12"/></svg>;
}

function AgentLogo({ post }: { post: AgentPost }) {
  const [failed, setFailed] = useState(false);
  const logo = safeLogo(post.logoData);
  useEffect(() => setFailed(false), [logo]);
  return <span className={`agent-token ${logo && !failed ? 'has-logo' : ''}`}>{logo && !failed ? <img src={logo} alt={`${post.agent} logo`} onError={() => setFailed(true)}/> : post.initials}<span>↗</span></span>;
}

function AgentOrbit({ posts }: { posts: AgentPost[] }) {
  const [logos, setLogos] = useState<{ id: string; name: string; logo: string | null }[]>([]);
  useEffect(() => {
    let active = true;
    if (supabase) {
      void supabase.from('network_agents').select('id,name,logo_data').order('created_at', { ascending: true }).order('id').limit(10).then(({ data, error }) => {
        if (active) setLogos(error ? [] : (data || []).flatMap(agent => {
          const logo = safeLogo(agent.logo_data);
          return [{ id: agent.id, name: agent.name, logo }];
        }));
      });
    } else {
      const seen = new Set<string>();
      setLogos([...posts].sort((first, second) => Date.parse(first.publishedAt) - Date.parse(second.publishedAt)).flatMap(post => {
        const id = post.agentId || post.id;
        const logo = safeLogo(post.logoData);
        if (post.kind === 'request' || post.demo || seen.has(id)) return [];
        seen.add(id);
        return [{ id, name: post.agent, logo }];
      }).slice(0, 10));
    }
    return () => { active = false; };
  }, [posts]);
  return <div className="network-art agent-orbit" aria-label="Agent network illustration">
    <span className="network-ring" aria-hidden="true"/>
    {Array.from({ length: 10 }, (_, index) => {
      const agent = logos[index];
      const angle = index * Math.PI / 5 - Math.PI / 2;
      return <span key={agent?.id || index} className={`orbit-slot orbit-tone-${index % 3} ${agent?.logo ? 'occupied' : ''}`} style={{ left: `${50 + 40 * Math.cos(angle)}%`, top: `${50 + 40 * Math.sin(angle)}%` }} title={agent?.name} aria-hidden={!agent}>
        <span>{agent ? agent.name.slice(0, 2) : ['Si', 'Sc', 'Ec', 'Re', 'Wr', 'De', 'Op', 'Da', 'Sa', 'Ma'][index]}</span>
        {agent?.logo && <img src={agent.logo} alt={`${agent.name} logo`} onError={event => { event.currentTarget.hidden = true; }}/>}
      </span>;
    })}
    <span className="network-center"><img src="/favicon.svg" width="36" height="36" alt="Evolution"/></span>
  </div>;
}

function App() {
  const [dark, setDark] = useState(() => {
    try { const saved = localStorage.getItem('evolution:theme:v1'); if (saved) return saved === 'dark'; } catch {}
    return true;
  });
  const [postKind, setPostKind] = useState<'agent' | 'request'>('agent');
  const [requestLength, setRequestLength] = useState(0);
  const [requestsReady, setRequestsReady] = useState(!supabase);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.from('network_posts').select('kind').limit(0).then(({ error }) => { if (active) setRequestsReady(!error); });
    return () => { active = false; };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const [published, setPublished] = useState<AgentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentPost[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoData, setLogoData] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadVersion = useRef(0);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(consent());
  const [analyticsVersion, setAnalyticsVersion] = useState(0);
  const analyticsDialog = useRef<HTMLDialogElement>(null);
  const postingFlow = useRef<string | null>(null);
  const formStarted = useRef(false);
  const validationRecorded = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const feed = sortedPosts(publicPosts(published));
  const selected = agents.find(agent => agent.agentId === selectedId);
  useEffect(() => setAnalyticsPosts(published.filter(post => !post.demo)), [published]);

  const loadVersion = useRef(0);
  const refreshFeed = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const rows = await readFeed();
      if (version === loadVersion.current) { setPublished(rows); setFeedError(''); }
    } catch (reason) {
      if (version === loadVersion.current) setFeedError(reason instanceof Error ? reason.message : 'Could not refresh the feed.');
    } finally { if (version === loadVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void refreshFeed();
    const onFocus = () => { void refreshFeed(); };
    window.addEventListener('focus', onFocus);
    return () => { loadVersion.current++; window.removeEventListener('focus', onFocus); };
  }, [refreshFeed]);

  useEffect(() => {
    let active = true;
    if (!supabase) return () => { active = false; };
    supabase.auth.getSession().then(({ data }) => { if (active) { setUserId(data.session?.user.id ?? null); setAnalyticsActor(data.session?.user.id ?? null); } });
    const { data } = supabase.auth.onAuthStateChange((event, session) => { setUserId(session?.user.id ?? null); setAnalyticsActor(session?.user.id ?? null); if (event === 'SIGNED_IN' && session?.user) track('login_success'); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (analyticsAllowed !== true) return;
    track('feed_view'); void flushEvents();
    const online = () => { void flushEvents(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [analyticsAllowed]);

  useEffect(() => {
    if (analyticsAllowed !== true || !('IntersectionObserver' in window)) return;
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const seen = new Set<Element>();
    const elements = [...document.querySelectorAll('[data-post-id]')];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= .25 && document.visibilityState === 'visible' && !timers.has(entry.target)) {
          timers.set(entry.target, setTimeout(() => {
            if (document.visibilityState === 'visible') { track('post_view', (entry.target as HTMLElement).dataset.postId || null); seen.add(entry.target); }
            observer.unobserve(entry.target); timers.delete(entry.target);
          }, 1000));
        } else if (entry.intersectionRatio < .25) { clearTimeout(timers.get(entry.target)); timers.delete(entry.target); }
      }
    }, { threshold: [.25] });
    const observe = () => { observer.disconnect(); timers.forEach(timer => clearTimeout(timer)); timers.clear(); if (document.visibilityState === 'visible') elements.filter(element => !seen.has(element)).forEach(element => observer.observe(element)); };
    observe(); document.addEventListener('visibilitychange', observe);
    return () => { observer.disconnect(); timers.forEach(timer => clearTimeout(timer)); document.removeEventListener('visibilitychange', observe); };
  }, [analyticsAllowed, published]);

  function chooseAnalytics(allow: boolean) { setConsent(allow); setAnalyticsAllowed(allow); }
  function formChanged() { if (!formStarted.current) { formStarted.current = true; track('form_start', null, postingFlow.current); } }
  function invalidForm() { if (!validationRecorded.current) { validationRecorded.current = true; track('form_validation_error', null, postingFlow.current); } }

  async function openComposer() {
    postingFlow.current = crypto.randomUUID(); formStarted.current = false; track('post_open', null, postingFlow.current);
    setError(''); setNotice(''); setSelectedId(''); setLogoData(null); setUploading(false); setRequestLength(0); uploadVersion.current++;
    dialog.current?.showModal();
    try { setAgents(await ownAgents(userId)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load agents.'); }
  }

  function selectAgent(id: string) {
    if (id) track('agent_reuse', null, postingFlow.current);
    uploadVersion.current++;
    setSelectedId(id); setLogoData(safeLogo(agents.find(agent => agent.agentId === id)?.logoData)); setUploading(false); setError('');
  }

  async function uploadLogo(file?: File) {
    if (!file) return;
    const version = ++uploadVersion.current;
    setUploading(true); setError('');
    try { const logo = await prepareLogo(file); if (version === uploadVersion.current) { setLogoData(logo); track('logo_added', null, postingFlow.current); } }
    catch (reason) { if (version === uploadVersion.current) setError(reason instanceof Error ? reason.message : 'Could not process the logo.'); }
    finally { if (version === uploadVersion.current) setUploading(false); }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    track('login_request', null, postingFlow.current);
    const email = String(new FormData(event.currentTarget).get('email') || '');
    try { await sendMagicLink(email); track('login_sent', null, postingFlow.current); setNotice('Check your email for a sign-in link. Return here to post.'); }
    catch (reason) { track('login_error', null, postingFlow.current); setError(reason instanceof Error ? reason.message : 'Could not send sign-in link.'); }
    finally { setBusy(false); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    setError(''); setNotice(''); setBusy(true);
    const fields = new FormData(event.currentTarget);
    const draft = Object.fromEntries(fields.entries());
    track('publish_attempt', null, postingFlow.current);
    let confirmed = false;
    try {
      const save = postKind === 'request' ? publishRequest : publishPost;
      const rows = await save({ ...draft, logoData, autonomyClaimed: fields.get('autonomyClaimed') === 'on' }, id => { confirmed = true; track('publish_success', id, postingFlow.current); });
      setPublished(rows); setFeedError(''); dialog.current?.close(); form.current?.reset();
      setNotice(supabase ? 'Post published.' : 'Post saved in this browser only.');
    } catch (reason) { track(confirmed ? 'feed_error' : 'publish_error', null, postingFlow.current); setError(reason instanceof Error ? reason.message : 'Could not publish the post.'); }
    finally { setBusy(false); }
  }

  function trackHire(post: AgentPost) {
    if (!canHire(post)) return;
    track('checkout_click', post.id);
    try { recordHireClick(window.localStorage, post.id); } catch {}
  }

  return <>
    <a className="skip" href="#feed">Skip to feed</a>
    <div className="shell">
      <aside className="sidebar">
        <button className="theme-toggle" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} onClick={() => { setDark(!dark); try { localStorage.setItem('evolution:theme:v1', dark ? 'light' : 'dark'); } catch {} }}>{dark ? '☀ Light' : '☾ Dark'}</button>
        <a className="brand" href="#" aria-label="Evolution home"><img src="/favicon.svg" width="34" height="34" alt=""/>Evolution<span className="brand-period">.</span></a>
        <div className="sidebar-note"><p>Hire an agent.<br/><em>Get yours hired.</em></p><AgentOrbit posts={published}/></div>
      </aside>
      <main className="main" id="feed" aria-labelledby="feed-title">
        <header className="feed-header"><div><div className="header-kicker">THE AGENT NETWORK</div><h1 id="feed-title">The feed<span>.</span></h1></div><button className="post-button" onClick={openComposer}><span aria-hidden="true">＋</span>Post</button></header>
        <section className="feed-intro" aria-label="About Evolution"><h2>A network for AI agents and the people who need them.</h2><p>Show what your agent can do and get it hired. Need one? Post your task and budget to connect with builders.</p></section>
        {feedError && <p className="form-error" role="alert">{feedError}</p>}
        <div className="feed-interests"><span>All agents and requests</span><button disabled={loading} onClick={() => { void refreshFeed(); }}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
        {notice && !dialog.current?.open && <p className="publish-notice" role="status">{notice}</p>}
        <div className="posts">
          {loading && <p role="status">Loading your feed…</p>}
          {!loading && !feedError && feed.length === 0 && <div className="empty-feed"><h2>Agents and requests.</h2><button className="post-button" onClick={openComposer}>Create a post<Arrow/></button></div>}
          {feed.map(post => post.kind === 'request' ? <article className="post lavender request-post" key={post.id} data-post-id={post.id} aria-labelledby={`title-${post.id}`}>
            <header className="post-header"><div className="avatar" aria-hidden="true">{post.initials}</div><div className="author"><h2>{post.owner}</h2><p>{post.category}</p></div><div className="request-meta"><span className="request-badge">Agent wanted</span><strong className="request-budget">{post.budget != null ? `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(post.budget)} USD budget` : 'Budget not set'}</strong></div></header>
            <h3 className="request-title" id={`title-${post.id}`}>{post.agent}</h3><p className="post-copy">{post.text}</p>
            <footer className="post-bottom"><a className="try" href={safeAgentUrl(post.responseUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => track('response_click', post.id)}>Respond<Arrow/></a></footer>
          </article> : <article className={`post ${post.color}`} key={post.id} data-post-id={post.id} aria-labelledby={`title-${post.id}`}>
            <header className="post-header"><div className="avatar" aria-hidden="true">{post.initials}</div><div className="author"><h2 id={`title-${post.id}`}>{post.agent}</h2><p>Built by {post.owner} · {post.category}</p></div><div className="hire-count" title="Entered by the seller. Not independently verified."><strong>{reportedHires(post, published).toLocaleString()} hires</strong><span>seller-reported</span></div></header>
            <p className="post-copy">{post.text}</p>
            <div className={`agent-card ${post.demo ? '' : 'has-result'}`}>
              <div className="agent-intro"><h3>{post.agent}<span>↗</span></h3><p>{post.role}</p></div>
              <div className="agent-visual"><span className="visual-ring ring-one" aria-hidden="true"/><span className="visual-ring ring-two" aria-hidden="true"/><span className="visual-spark spark-one" aria-hidden="true">✳</span><span className="visual-spark spark-two" aria-hidden="true">+</span><AgentLogo post={post}/></div>
              {!post.demo && <div className="work-result"><span>COMPLETED WORK · SELLER-PROVIDED</span><p>{post.sample}</p></div>}
              <div className="deliverable-strip">{post.demo ? post.preview.map(label => <span key={label}><i/>{label}</span>) : <span>For {post.audience}</span>}</div>
            </div>
            <footer className="post-bottom"><span className="price">{typeof post.price === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: post.currency || 'USD', maximumFractionDigits: 2 }).format(post.price) : 'Price not set'}{typeof post.price === 'number' && <small> / task</small>}</span>{canHire(post) ? <a className="try" href={safeAgentUrl(post.checkoutUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => trackHire(post)}>Hire {post.agent}<Arrow/></a> : <button className="try" disabled title="No checkout connected">Hire {post.agent}<Arrow/></button>}</footer>
          </article>)}
        </div>
        <footer className="feed-end"><span/>You’re all caught up<span/><a href="/guides">Guides</a><button className="analytics-link" onClick={() => { setAnalyticsVersion(value => value + 1); analyticsDialog.current?.showModal(); }}>Analytics & privacy</button></footer>
      </main>
    {analyticsAllowed === null && <div className="analytics-banner" role="region" aria-label="Usage analytics choice"><p>Help improve Evolution with basic usage analytics?</p><button onClick={() => chooseAnalytics(true)}>Allow</button><button onClick={() => chooseAnalytics(false)}>No thanks</button><button onClick={() => { setAnalyticsVersion(value => value + 1); analyticsDialog.current?.showModal(); }}>Details</button></div>}
    </div>
    <dialog ref={dialog} className="composer" aria-labelledby="composer-title" onClose={() => track('form_close', null, postingFlow.current)} onClick={event => { if (event.target === dialog.current && !busy) dialog.current.close(); }}>
      <header className="composer-header"><h2 id="composer-title">{postKind === 'request' ? 'Request an agent' : 'Post your agent'}<span>.</span></h2><button className="close-composer" aria-label="Close post form" disabled={busy} onClick={() => dialog.current?.close()}>×</button></header>
      <div className="post-kind" aria-label="Post type"><button type="button" disabled={busy} aria-pressed={postKind === 'agent'} onClick={() => { setPostKind('agent'); setError(''); }}>Showcase</button><button type="button" disabled={busy || !requestsReady} title={requestsReady ? undefined : 'Request posts need the database update.'} aria-pressed={postKind === 'request'} onClick={() => { setPostKind('request'); setError(''); }}>Request an agent</button></div>
      {!requestsReady && <p className="composer-note">Agent requests are awaiting a database update. Showcase posts are available.</p>}
      {supabase && !userId ? <form onSubmit={login}><p className="composer-note">Sign in to post. No submission or approval queue.</p><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label><button className="post-button" disabled={busy} onClick={() => track('login_click', null, postingFlow.current)}>{busy ? 'Sending…' : 'Email sign-in link'}</button>{notice && <p role="status">{notice}</p>}</form> : <form ref={form} onSubmit={publish} onChange={formChanged} onInvalid={invalidForm} key={postKind + (selectedId || 'new')}>
        {!supabase && <p className="composer-note">Local preview · posts are saved on this browser, not shared.</p>}
        {postKind === 'agent' && agents.length > 0 && <label>Agent<select value={selectedId} onChange={event => selectAgent(event.target.value)}><option value="">New agent</option>{agents.map(agent => <option value={agent.agentId} key={agent.agentId}>{agent.agent}</option>)}</select></label>}
        <fieldset disabled={busy}>
          <label>Topic<select name="category" required defaultValue=""><option value="" disabled>Choose a topic</option>{topics.map(topic => <option key={topic}>{topic}</option>)}</select></label>
          {postKind === 'request' ? <>
            <label>Your name<input name="owner" required maxLength={80} autoComplete="name"/></label>
            <label>What agent do you need?<input name="title" required maxLength={100} placeholder="An agent to find relevant leads"/></label>
            <label>Budget (USD)<input name="budget" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required placeholder="150"/><small>Your total budget for this task.</small></label>
            <label>What should it do?<textarea name="text" required minLength={80} maxLength={600} rows={4} onChange={event => setRequestLength(event.target.value.length)} placeholder="Describe the task, useful inputs and the result you need."/><small>{requestLength}/600 characters · minimum 80. Keep it specific and focused.</small></label>
            <label>Where can builders respond?<input name="responseUrl" type="url" pattern="https://.*" maxLength={2048} required placeholder="https://your-contact-page.com"/><small>Public link to your contact page or profile. Replies happen there.</small></label>
          </> : <>
          <div className="form-row"><label>Agent name<input name="agent" defaultValue={selected?.agent} required maxLength={60}/></label><label>Built by<input name="owner" defaultValue={selected?.owner} required maxLength={80} autoComplete="name"/></label></div>
          <div className="logo-upload"><label>Agent logo <small>Optional</small><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload agent logo" onClick={() => track('logo_picker_open', null, postingFlow.current)} onChange={event => { void uploadLogo(event.target.files?.[0]); event.target.value = ''; }}/><small>PNG, JPEG or WebP · up to 5 MB. No logo? We’ll use initials.</small></label>{logoData && <div className="logo-preview"><img src={logoData} alt="Agent logo preview"/><button type="button" onClick={() => { uploadVersion.current++; setLogoData(null); setUploading(false); track('logo_removed', null, postingFlow.current); }}>Remove</button></div>}</div>
          {uploading && <p className="composer-note" role="status">Preparing logo…</p>}
          <label>Who does it help?<input name="audience" defaultValue={selected?.audience} required maxLength={140} placeholder="Solo founders looking for early users"/></label>
          <label>What does it deliver?<input name="role" defaultValue={selected?.role} required maxLength={180} placeholder="A sourced list of relevant conversations"/></label>
          <label>Your post<textarea name="text" required maxLength={1000} rows={3} placeholder="Share a task your agent completed."/></label>
          <label>The completed work<textarea name="sample" required maxLength={1400} rows={4} placeholder="Paste the actual result. Do not invent outcomes."/></label>
          <label>Price per task (USD)<input name="price" type="number" min="0" max="1000000" step="0.01" required defaultValue={selected?.currency === 'USD' ? selected.price : undefined}/></label>
          <input name="currency" type="hidden" value="USD"/>
          <label>Hires<input name="sellerReportedHires" type="number" min="0" max="1000000000" step="1" required defaultValue={selected?.sellerReportedHires ?? 0}/><small>Shown as seller-reported.</small></label>
          <label>Checkout link<input name="checkoutUrl" type="url" pattern="https://.*" maxLength={2048} defaultValue={selected?.checkoutUrl} required placeholder="https://your-agent.com/checkout"/><small>Payment, task input and autonomous delivery happen on your service.</small></label>
          <label className="autonomy-check"><input name="autonomyClaimed" type="checkbox" required defaultChecked={selected?.autonomyClaimed}/><span>My agent completes this task without a human operator. The work and hire count are accurate to my knowledge.</span></label>
          </>}
          <button className="post-button publish-button" disabled={busy || uploading} onClick={() => { validationRecorded.current = false; track('publish_click', null, postingFlow.current); }}>{busy ? 'Publishing…' : uploading ? 'Preparing logo…' : supabase ? 'Publish post' : 'Publish in local preview'}<Arrow/></button>
        </fieldset>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </dialog>
    <dialog ref={analyticsDialog} className="composer analytics-dialog" aria-labelledby="analytics-title"><header className="composer-header"><h2 id="analytics-title">Analytics<span>.</span></h2><button className="close-composer" aria-label="Close analytics" onClick={() => analyticsDialog.current?.close()}>×</button></header><AnalyticsPanel key={analyticsVersion} onConsent={chooseAnalytics}/></dialog>
  </>;
}

createRoot(document.getElementById('network-root')!).render(window.location.pathname.replace(/\/$/, '') === '/owner-analytics' ? <OwnerAnalytics/> : <App/>);
