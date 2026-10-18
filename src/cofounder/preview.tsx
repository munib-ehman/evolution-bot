import {createRoot} from 'react-dom/client';
import {FounderAvatar} from './Avatar';
createRoot(document.getElementById('cofounder-preview')!).render(<><FounderAvatar/><div className="founder-preview-caption"><span className="founder-status-dot"/> One co-founder. From your idea to first feedback.</div></>);
