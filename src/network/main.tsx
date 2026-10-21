import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import posts from './posts.json';
import { canTry, recordTry, safeAgentUrl, sortedPosts, type AgentPost } from './model.mjs';
import './network.css';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M4 12h16m-6-6 6 6-6 6'} /></svg>;
}

function App() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<AgentPost | null>(null);
  const feed = sortedPosts(posts);
  function showExample(post: AgentPost) {
    setSelected(post);
    dialog.current?.showModal();
  }
  function trackTry(post: AgentPost) {
    if (!canTry(post)) return;
    try { recordTry(window.localStorage, post.id); } catch {}
  }
  return <>
    <a className="skip" href="#feed">Skip to agent posts</a>
    <header className="header">
      <a className="brand" href="#" aria-label="Evolution home"><img src="/favicon.svg" width="33" height="33" alt="" /><span>Evolution</span></a>
      <span className="preview-label">Agents, at work.<span className="preview-dot" /></span>
    </header>
    <main className="layout">
      <section className="feed" id="feed" aria-labelledby="feed-title">
        <div className="feed-heading"><h1 id="feed-title">Feed<span className="feed-mark" aria-hidden="true">✳</span></h1><span className="sort-label">Latest ↓</span></div>
        {feed.some(post => post.demo) && <p className="demo-notice">Preview · sample agents aren’t connected.</p>}
        {feed.length ? feed.map(post => <article className="post" key={post.id} aria-labelledby={`title-${post.id}`}>
          <header className="post-header"><div className={`author-avatar ${post.color}`} aria-hidden="true">{post.owner.split(' ').map(part => part[0]).slice(0, 2).join('')}</div><div className="post-identity"><h2 id={`title-${post.id}`}>{post.owner}</h2><p>Sharing {post.agent} <span>·</span> {post.demo ? 'Sample' : new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p></div><span className="post-label">{post.demo ? 'Demo' : canTry(post) ? 'Available' : 'Offline'}</span></header>
          <p className="post-copy">{post.text}</p>
          <div className={`work-preview ${post.color}`}><div className="agent-summary"><span className="agent-symbol" aria-hidden="true">{post.initials}</span><div><h3>{post.agent}</h3><p>{post.role}</p></div></div><div className="mini-output" aria-hidden="true"><span className="mini-output-title">{post.demo ? 'Sample output' : 'Work sample'} <span>↗</span></span>{post.preview.map(label => <div key={label}><i />{label}</div>)}</div><span className="tile-orbit" aria-hidden="true" /></div>
          <footer className="post-footer"><button className="example-button" onClick={() => showExample(post)} aria-label={`View ${post.agent} ${post.demo ? 'sample output' : 'proof of work'}`}>{post.demo ? 'View sample' : 'View work'} <Arrow /></button>{canTry(post) ? <a className="try-button" href={safeAgentUrl(post.tryUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => trackTry(post)}>Try agent <Arrow diagonal /></a> : <button className="try-button" disabled title="No live agent connected">Try agent <Arrow diagonal /></button>}</footer>
        </article>) : <div className="empty-state"><h3>No agents yet.</h3><p>Tested agents will appear here.</p></div>}
        <footer className="feed-end">You’re all caught up <span aria-hidden="true">✳</span></footer>
      </section>
    </main>
    <dialog className="example-dialog" ref={dialog} aria-labelledby="example-title" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="dialog-top"><span className="eyebrow">{selected?.demo ? 'SAMPLE' : 'WORK'}</span><button className="close-button" onClick={() => dialog.current?.close()} aria-label="Close example">×</button></div>
      <h2 id="example-title">{selected?.agent}</h2>
      {selected?.demo && <p className="dialog-note">Example format. Not a live agent run.</p>}
      <dl className="task-details"><dt>Input</dt><dd>{selected?.input}</dd><dt>Output</dt><dd>{selected?.output}</dd></dl>
      <pre>{selected?.sample}</pre>
      <button className="back-button" onClick={() => dialog.current?.close()}>Back to feed <Arrow /></button>
    </dialog>
  </>;
}

createRoot(document.getElementById('network-root')!).render(<App />);
