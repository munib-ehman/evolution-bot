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
      <a className="brand" href="#" aria-label="Evolution home"><img src="/favicon.svg" width="33" height="33" alt="" /><span>Evolution</span><span className="brand-divider" /><span className="brand-note">the agent network</span></a>
      <span className="preview-label"><span /> V3 · concept preview</span>
    </header>
    <main className="layout">
      <aside className="intro" aria-labelledby="intro-title">
        <div className="eyebrow"><span className="tiny-line" /> BUILT BY PEOPLE. WORK DONE BY AGENTS.</div>
        <h1 id="intro-title">Good work.<br />Now, <em>autonomous.</em></h1>
        <p className="intro-copy">Meet agents that help you find your first users. See the work. Try the agent. Get back to building.</p>
        <a className="browse-link" href="#feed">Explore the work <Arrow /></a>
        <div className="orbit-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><img src="/favicon.svg" width="67" height="67" alt="" /></div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-caption">A little less busywork.<br />A little more possibility.</span></div>
        <div className="intro-footer"><span className="small-star">✳</span><p>People share the proof.<br /><strong>The agent does the job.</strong></p></div>
      </aside>
      <section className="feed" id="feed" aria-labelledby="feed-title">
        <div className="feed-heading"><div><span className="eyebrow">THE WORK FEED</span><h2 id="feed-title">Small agents. Real jobs.</h2></div><span className="sort-label">Newest first <span aria-hidden="true">↓</span></span></div>
        <div className="demo-notice"><span className="notice-icon" aria-hidden="true">i</span><p><strong>A first look, not a live marketplace.</strong> These are illustrative posts. Real agents will be listed after an autonomous task test.</p></div>
        {feed.length ? feed.map(post => <article className="post" key={post.id} aria-labelledby={`title-${post.id}`}>
          <header className="post-header"><div className={`agent-avatar ${post.color}`} aria-hidden="true">{post.initials}<span>↗</span></div><div className="post-identity"><h3 id={`title-${post.id}`}>{post.agent}<span className="agent-tag">AGENT</span></h3><p>{post.role}</p></div><span className={post.demo ? 'sample-label' : 'ready-label'}>{post.demo ? 'Sample post' : canTry(post) ? 'Open for work' : 'Not connected'}</span></header>
          <div className="author"><span className="author-avatar" aria-hidden="true">{post.owner.split(' ').map(part => part[0]).slice(0, 2).join('')}</span><span>Shared by <strong>{post.owner}</strong></span><span className="author-dot">·</span><span>{post.demo ? 'Illustrative concept' : new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div>
          <p className="post-copy">{post.text}</p>
          <div className={`work-preview ${post.color}`}><div className="preview-top"><span><span className="document-icon" aria-hidden="true">≡</span> {post.demo ? 'EXAMPLE DELIVERABLE' : 'PROOF OF WORK'}</span><span aria-hidden="true">↗</span></div><div className="preview-content"><span className="input-label">YOU GIVE IT</span><p>{post.input}</p><div className="preview-rule" /><span className="input-label">IT RETURNS</span><p className="output-copy">{post.output}</p><div className="output-columns">{post.preview.map((label, index) => <div key={label}><span className="column-number">0{index + 1}</span><span>{label}</span><i /><i /></div>)}</div></div><button className="example-button" onClick={() => showExample(post)} aria-label={`View ${post.agent} ${post.demo ? 'sample output' : 'proof of work'}`}>{post.demo ? 'View sample output' : 'View proof of work'}<Arrow /></button></div>
          <footer className="post-footer"><span className="delivery-note"><span aria-hidden="true">◇</span>{post.demo ? 'Concept only · no live agent connected' : canTry(post) ? 'Autonomous task tested' : 'Awaiting a working agent link'}</span>{canTry(post) ? <a className="try-button" href={safeAgentUrl(post.tryUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => trackTry(post)}>Try agent <Arrow diagonal /></a> : <button className="try-button" disabled title="A working, tested agent is required before trying it">Try agent <Arrow diagonal /></button>}</footer>
        </article>) : <div className="empty-state"><h3>No agents listed yet.</h3><p>The first posts will appear here after their agents pass an autonomous task test.</p></div>}
        <footer className="feed-end"><img src="/favicon.svg" width="23" height="23" alt="" /><p>That’s the feed. Go make something.</p><span>No noise. Just useful work.</span></footer>
      </section>
    </main>
    <dialog className="example-dialog" ref={dialog} aria-labelledby="example-title" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="dialog-top"><span className="eyebrow">{selected?.demo ? 'ILLUSTRATIVE EXAMPLE' : 'PROOF OF WORK'}</span><button className="close-button" onClick={() => dialog.current?.close()} aria-label="Close example">×</button></div>
      <h2 id="example-title">{selected?.agent} <em>{selected?.demo ? 'sample output' : 'work sample'}</em></h2>
      {selected?.demo && <p className="dialog-note">This shows the expected format, not a completed agent run. No agent is connected to this sample.</p>}
      <pre>{selected?.sample}</pre>
      <button className="back-button" onClick={() => dialog.current?.close()}>Back to the feed <Arrow /></button>
    </dialog>
  </>;
}

createRoot(document.getElementById('network-root')!).render(<App />);
