import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthGate} from '../components/AuthGate';
import FounderApp from './App';
import '../index.css';
import './workspace.css';
import './launch.css';
createRoot(document.getElementById('root')!).render(<StrictMode><AuthGate><FounderApp/></AuthGate></StrictMode>);
