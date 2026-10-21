import { createRoot } from 'react-dom/client';
import posts from './posts.json';
import { canTry, recordTry, safeAgentUrl, sortedPosts, type AgentPost } from './model.mjs';
import './network.css';

function Icon({ name }: { name: 'feed' | 'arrow' | 'work' }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'feed' ? <><rect x="4" y="3" width="16" height="18" rx="4"/><path d="M8 8h8M8 12h8M8 16h4"/></> : name === 'arrow' ? <path d="m6 18 12-12M6 6h12v12"/> : <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M9 7V4h6v3M4 12h16m-10 0v3h4v-3"/></>}</svg>;
}

function App() {
  const feed = sortedPosts(posts);
  function trackTry(post: AgentPost) {
    if (!canTry(post)) return;
    try { recordTry(window.localStorage, post.id); } catch {}
  }
  return <>
    <a className="skip" href="#feed">Skip to feed</a>
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Evolution home"><img src="/favicon.svg" width="34" height="34" alt="" />Evolution<span className="brand-period">.</span></a>
        <div className="sidebar-note"><span className="eyebrow">A NEW KIND OF NETWORK</span><p>People build.<br/><em>Agents work.</em></p><div className="network-art" aria-hidden="true"><span className="network-ring"/><span className="network-node node-one">Si</span><span className="network-node node-two">Sc</span><span className="network-node node-three">Ec</span><span className="network-center"><img src="/favicon.svg" width="36" height="36" alt=""/></span></div></div>
        <div className="sidebar-footer"><span/>Independent by design.</div>
      </aside>
      <main className="main" id="feed" aria-labelledby="feed-title">
        <header className="feed-header"><div><div className="header-kicker">THE AGENT NETWORK</div><h1 id="feed-title">The feed<span>.</span></h1></div></header>
        {feed.some(post => post.demo) && <p className="demo-note">Sample posts. Live agents aren’t connected yet.</p>}
        <div className="posts">
          {feed.length ? feed.map(post => <article className={`post ${post.color}`} key={post.id} aria-labelledby={`title-${post.id}`}>
            <header className="post-header"><div className="avatar" aria-hidden="true">{post.owner.split(' ').map(part => part[0]).slice(0, 2).join('')}</div><div className="author"><h2 id={`title-${post.id}`}>{post.owner}</h2><p>Builder <span>·</span> {post.demo ? 'Sample post' : new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p></div><span className="post-type"><Icon name="work"/>Agent showcase</span></header>
            <p className="post-copy">{post.text}</p>
            <div className="agent-card">
              <div className="agent-intro"><span className="agent-chip"><i/>{post.demo ? 'AGENT CONCEPT' : canTry(post) ? 'OPEN FOR WORK' : 'NOT CONNECTED'}</span><h3>{post.agent}<span>↗</span></h3><p>{post.role}</p></div>
              <div className="agent-visual" aria-hidden="true"><span className="visual-ring ring-one"/><span className="visual-ring ring-two"/><span className="visual-spark spark-one">✳</span><span className="visual-spark spark-two">+</span><span className="agent-token">{post.initials}<span>↗</span></span></div>
              <div className="deliverable-strip">{post.preview.map(label => <span key={label}><i/>{label}</span>)}</div>
            </div>
            <footer className="post-bottom"><details className="work"><summary>View {post.demo ? 'sample' : 'work'} <span aria-hidden="true">↗</span></summary><pre>{post.sample}</pre></details>{canTry(post) ? <a className="try" href={safeAgentUrl(post.tryUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => trackTry(post)}>Try agent <Icon name="arrow"/></a> : <button className="try" disabled title="No live agent connected">Try agent <Icon name="arrow"/></button>}</footer>
          </article>) : <p className="empty">No agents yet.</p>}
        </div>
        <footer className="feed-end"><span/>You’re all caught up<span/></footer>
      </main>
    </div>
  </>;
}

createRoot(document.getElementById('network-root')!).render(<App />);
