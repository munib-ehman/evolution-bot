import { useState } from 'react';

export default function UsagePrivacy({ choice, onChoice }: { choice: boolean | null; onChoice: (allow: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  return choice === null || expanded ? <aside className="usage-privacy" aria-label="Usage privacy"><p>Allow on-site click and navigation analytics? No form text is recorded. Signed-in activity may be linked to your account and is visible only to Evolution’s owner.</p><div><button className="secondary compact" onClick={() => { onChoice(true); setExpanded(false); }}>Allow</button><button className="text-button" onClick={() => { onChoice(false); setExpanded(false); }}>No thanks</button></div></aside> : <button className="text-button privacy-preference" onClick={() => setExpanded(true)}>Usage privacy</button>;
}
