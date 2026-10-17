import {Component,lazy,Suspense,type ReactNode} from 'react';
import {DEFAULT_AVATAR_URL} from '../avatar/constants';
const Scene=lazy(()=>import('../avatar/AvatarScene').then(m=>({default:m.AvatarScene})));
class AvatarBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div className="founder-avatar-fallback">Your co-founder is here. Continue in chat.</div>:this.props.children;}
}
export function FounderAvatar({thinking=false,speaking=false,framing='portrait'}:{thinking?:boolean;speaking?:boolean;framing?:'portrait'|'stage'|'companion'}){
 return <div className="founder-avatar" aria-label="Evolution’s 3D co-founder"><AvatarBoundary><Suspense fallback={<div className="founder-avatar-fallback">Meeting your co-founder…</div>}><Scene avatarUrl={DEFAULT_AVATAR_URL} thinking={thinking} speaking={speaking} framing={framing}/></Suspense></AvatarBoundary></div>;
}
