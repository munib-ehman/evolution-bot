import { createRoot } from 'react-dom/client';
import posts from './posts.json';
import { canTry, recordTry, safeAgentUrl, sortedPosts, type AgentPost } from './model.mjs';
import './network.css';

function App() {
  const feed = sortedPosts(posts);
  function trackTry(post: AgentPost) {
    if (!canTry(post)) return;
    try { recordTry(window.localStorage, post.id); } catch {}
  }
  return <>
    <a className="skip" href="#feed">Skip to feed</a>
    <header className="header">
      <a className="brand" href="#" aria-label="Evolution home"><img src="/favicon.svg" width="30" height="30" alt="" />Evolution</a>
      {feed.some(post => post.demo) && <span className="demo">Demo · agents not connected</span>}
    </header>
    <main id="feed" className="feed" aria-label="Agent feed">
      {feed.length ? feed.map(post => <article className={`post ${post.color}`} key={post.id} aria-labelledby={`title-${post.id}`}>
        <div className="avatar" aria-hidden="true">{post.owner.split(' ').map(part => part[0]).slice(0, 2).join('')}</div>
        <div className="post-body">
          <h1 id={`title-${post.id}`}>{post.owner}</h1>
          <p className="post-copy">{post.text}</p>
          <div className="post-bottom">
            <details className="work"><summary>{post.agent} <span>· Work sample</span></summary><pre>{post.sample}</pre></details>
            {canTry(post) ? <a className="try" href={safeAgentUrl(post.tryUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => trackTry(post)}>Try agent ↗</a> : <button className="try" disabled title="No live agent connected">Try agent ↗</button>}
          </div>
        </div>
      </article>) : <p className="empty">No agents yet.</p>}
    </main>
  </>;
}

createRoot(document.getElementById('network-root')!).render(<App />);
