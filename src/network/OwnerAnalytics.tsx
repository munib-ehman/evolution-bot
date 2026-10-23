import { useEffect, useState, type FormEvent } from 'react';
import { supabase, sendMagicLink, signOut } from '../lib/auth';
import { OwnerJourneys } from './OwnerJourneys';

export function OwnerAnalytics() {
  const [access, setAccess] = useState<'checking' | 'signed-out' | 'denied' | 'owner'>('checking');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function check() {
      if (!supabase) { setAccess('denied'); return; }
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) { if (active) setAccess('signed-out'); return; }
        const result = await supabase.rpc('network_is_analytics_admin');
        if (active) setAccess(!result.error && result.data === true ? 'owner' : 'denied');
      } catch { if (active) setAccess('denied'); }
    }
    void check();
    const subscription = supabase?.auth.onAuthStateChange(() => { setTimeout(() => { void check(); }, 0); });
    return () => { active = false; subscription?.data.subscription.unsubscribe(); };
  }, []);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') || '');
    setBusy(true); setNotice('');
    try { await sendMagicLink(email); setNotice('Check your email for the sign-in link.'); }
    catch { setNotice('Could not send a sign-in link. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className="owner-dashboard">
    <header className="composer-header"><h1>Platform analytics</h1><a href="/">Back to Evolution</a></header>
    {access === 'checking' && <p role="status">Checking owner access…</p>}
    {access === 'signed-out' && <form onSubmit={login}><p>Sign in with your authorized owner account.</p><label>Email<input name="email" type="email" autoComplete="email" required/></label><button className="post-button" disabled={busy}>{busy ? 'Sending…' : 'Email sign-in link'}</button></form>}
    {access === 'denied' && <><p role="alert">Owner access required. Platform analytics are private.</p><button className="post-button" onClick={() => { void signOut(); }}>Sign out</button></>}
    {notice && <p role="status">{notice}</p>}
    {access === 'owner' && <OwnerJourneys/>}
  </main>;
}
