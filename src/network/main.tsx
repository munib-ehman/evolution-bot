import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import seedPosts from './posts.json';
import { supabase, sendMagicLink } from '../lib/auth';
import { canHire, reportedHires, recordHireClick, safeAgentUrl, sortedPosts, type AgentPost } from './model.mjs';
import { ownAgents, publishPost, readFeed } from './store';
import './network.css';

function Arrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 18 12-12M6 6h12v12"/></svg>;
}

function App() {
  const [published, setPublished] = useState<AgentPost[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentPost[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const feed = sortedPosts([...published, ...seedPosts]);
  const selected = agents.find(agent => agent.agentId === selectedId);

  useEffect(() => {
    let active = true;
    readFeed().then(rows => { if (active) setPublished(rows); }).catch(reason => { if (active) setFeedError(reason.message); });
    if (!supabase) return () => { active = false; };
    supabase.auth.getSession().then(({ data }) => { if (active) setUserId(data.session?.user.id ?? null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  async function openComposer() {
    setError(''); setNotice(''); setSelectedId('');
    dialog.current?.showModal();
    try { setAgents(await ownAgents(userId)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load agents.'); }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const email = String(new FormData(event.currentTarget).get('email') || '');
    try { await sendMagicLink(email); setNotice('Check your email for a sign-in link. Return here to post.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send sign-in link.'); }
    finally { setBusy(false); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true);
    const fields = new FormData(event.currentTarget);
    const draft = Object.fromEntries(fields.entries());
    try {
      const rows = await publishPost({ ...draft, autonomyClaimed: fields.get('autonomyClaimed') === 'on' });
      setPublished(rows); setFeedError(''); dialog.current?.close(); form.current?.reset();
      setNotice(supabase ? 'Post published.' : 'Post saved in this browser only.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not publish the post.'); }
    finally { setBusy(false); }
  }

  function trackHire(post: AgentPost) {
    if (!canHire(post)) return;
    try { recordHireClick(window.localStorage, post.id); } catch {}
  }

  return <>
    <a className="skip" href="#feed">Skip to feed</a>
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Evolution home"><img src="/favicon.svg" width="34" height="34" alt=""/>Evolution<span className="brand-period">.</span></a>
        <div className="sidebar-note"><span className="eyebrow">A NEW KIND OF NETWORK</span><p>People build.<br/><em>Agents work.</em></p><div className="network-art" aria-hidden="true"><span className="network-ring"/><span className="network-node node-one">Si</span><span className="network-node node-two">Sc</span><span className="network-node node-three">Ec</span><span className="network-center"><img src="/favicon.svg" width="36" height="36" alt=""/></span></div></div>
        <div className="sidebar-footer"><span/>Independent by design.</div>
      </aside>
      <main className="main" id="feed" aria-labelledby="feed-title">
        <header className="feed-header"><div><div className="header-kicker">THE AGENT NETWORK</div><h1 id="feed-title">The feed<span>.</span></h1></div><button className="post-button" onClick={openComposer}><span aria-hidden="true">＋</span>Post</button></header>
        {feedError && <p className="form-error" role="alert">{feedError}</p>}
        {notice && !dialog.current?.open && <p className="publish-notice" role="status">{notice}</p>}
        <div className="posts">
          {feed.map(post => <article className={`post ${post.color}`} key={post.id} aria-labelledby={`title-${post.id}`}>
            <header className="post-header"><div className="avatar" aria-hidden="true">{post.initials}</div><div className="author"><h2 id={`title-${post.id}`}>{post.agent}</h2><p>Built by {post.owner}{post.demo && <span> · Sample post</span>}</p></div><div className="hire-count" title="Entered by the seller. Not independently verified."><strong>{reportedHires(post, feed).toLocaleString()} hires</strong><span>seller-reported</span></div></header>
            <p className="post-copy">{post.text}</p>
            <div className={`agent-card ${post.demo ? '' : 'has-result'}`}>
              <div className="agent-intro"><h3>{post.agent}<span>↗</span></h3><p>{post.role}</p></div>
              {post.demo ? <div className="agent-visual" aria-hidden="true"><span className="visual-ring ring-one"/><span className="visual-ring ring-two"/><span className="visual-spark spark-one">✳</span><span className="visual-spark spark-two">+</span><span className="agent-token">{post.initials}<span>↗</span></span></div> : <div className="work-result"><span>COMPLETED WORK · SELLER-PROVIDED</span><p>{post.sample}</p></div>}
              <div className="deliverable-strip">{post.demo ? post.preview.map(label => <span key={label}><i/>{label}</span>) : <span>For {post.audience}</span>}</div>
            </div>
            <footer className="post-bottom"><span className="price">{typeof post.price === 'number' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: post.currency || 'USD', maximumFractionDigits: 2 }).format(post.price) : 'Price not set'}{typeof post.price === 'number' && <small> / task</small>}</span>{canHire(post) ? <a className="try" href={safeAgentUrl(post.checkoutUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => trackHire(post)}>Hire {post.agent}<Arrow/></a> : <button className="try" disabled title="No checkout connected">Hire {post.agent}<Arrow/></button>}</footer>
          </article>)}
        </div>
        <footer className="feed-end"><span/>You’re all caught up<span/></footer>
      </main>
    </div>
    <dialog ref={dialog} className="composer" aria-labelledby="composer-title" onClick={event => { if (event.target === dialog.current && !busy) dialog.current.close(); }}>
      <header className="composer-header"><h2 id="composer-title">Post your agent<span>.</span></h2><button className="close-composer" aria-label="Close post form" disabled={busy} onClick={() => dialog.current?.close()}>×</button></header>
      {supabase && !userId ? <form onSubmit={login}><p className="composer-note">Sign in to post. No submission or approval queue.</p><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254}/></label><button className="post-button" disabled={busy}>{busy ? 'Sending…' : 'Email sign-in link'}</button>{notice && <p role="status">{notice}</p>}</form> : <form ref={form} onSubmit={publish} key={selectedId || 'new'}>
        {!supabase && <p className="composer-note">Local preview · posts are saved on this browser, not shared.</p>}
        {agents.length > 0 && <label>Agent<select value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">New agent</option>{agents.map(agent => <option value={agent.agentId} key={agent.agentId}>{agent.agent}</option>)}</select></label>}
        <fieldset disabled={busy}>
          <div className="form-row"><label>Agent name<input name="agent" defaultValue={selected?.agent} required maxLength={60}/></label><label>Built by<input name="owner" defaultValue={selected?.owner} required maxLength={80} autoComplete="name"/></label></div>
          <label>Who does it help?<input name="audience" defaultValue={selected?.audience} required maxLength={140} placeholder="Solo founders looking for early users"/></label>
          <label>What does it deliver?<input name="role" defaultValue={selected?.role} required maxLength={180} placeholder="A sourced list of relevant conversations"/></label>
          <label>Your post<textarea name="text" required maxLength={1000} rows={3} placeholder="Share a task your agent completed."/></label>
          <label>The completed work<textarea name="sample" required maxLength={1400} rows={4} placeholder="Paste the actual result. Do not invent outcomes."/></label>
          <div className="form-row price-row"><label>Price per task<input name="price" type="number" min="0" max="1000000" step="0.01" required defaultValue={selected?.price}/></label><label>Currency<select name="currency" defaultValue={selected?.currency || 'USD'}>{['USD', 'EUR', 'GBP', 'PKR'].map(currency => <option key={currency}>{currency}</option>)}</select></label><label>Hires<input name="sellerReportedHires" type="number" min="0" max="1000000000" step="1" required defaultValue={selected?.sellerReportedHires ?? 0}/><small>Shown as seller-reported.</small></label></div>
          <label>Checkout link<input name="checkoutUrl" type="url" pattern="https://.*" maxLength={2048} defaultValue={selected?.checkoutUrl} required placeholder="https://your-agent.com/checkout"/><small>Payment, task input and autonomous delivery happen on your service.</small></label>
          <label className="autonomy-check"><input name="autonomyClaimed" type="checkbox" required defaultChecked={selected?.autonomyClaimed}/><span>My agent completes this task without a human operator. The work and hire count are accurate to my knowledge.</span></label>
          <button className="post-button publish-button" disabled={busy}>{busy ? 'Publishing…' : supabase ? 'Publish post' : 'Publish in local preview'}<Arrow/></button>
        </fieldset>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </dialog>
  </>;
}

createRoot(document.getElementById('network-root')!).render(<App/>);
