// DOM-level regression tests: no browser, credentials, email or production writes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const { JSDOM } = await import(pathToFileURL(process.env.JSDOM_MODULE).href);
const bundle = await build({
  entryPoints: ['src/jobs/main.tsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'test-auth', setup(builder) {
    builder.onLoad({ filter: /\/src\/lib\/auth\.ts$/ }, () => ({ contents: 'export const supabase = globalThis.__testSupabase;', loader: 'js' }));
  } }],
});
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com', user_metadata: {} };
const draft = { requester_name:'Owner',title:'  Daily stock report  ',description:'Prepare an inventory report each day and flag products that need restocking.',frequency:'Daily',budget:'100',email:user.email,contact_email:'public@example.com',contact_linkedin:'',contact_x:'',contact_url:'' };
async function until(check, label) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error(`Timed out: ${label}`);
}
async function mount({ sessionUser = null, pending, savedDraft, action = 'post', profile = null, initialSession, registerError = false, notifyError = false } = {}) {
  const dom = new JSDOM('<div id="network-root"></div>', { url: `https://www.runevolution.io/${action === 'board' ? '' : `?action=${action}`}`, runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  let listener;
  let currentUser = sessionUser;
  let currentProfile = profile;
  let published = false;
  const calls = { login:[], register:[], post:[], profile:0, fetch:0 };
  const session = () => ({ data:{session: currentUser ? { user:currentUser,access_token:'test-token' } : null}, error:null });
  const client = {
    auth: {
      getSession: async () => {
        if (published && notifyError) throw Error('Notification session unavailable');
        return initialSession ? await initialSession : session();
      },
      onAuthStateChange: callback => { listener=callback; return {data:{subscription:{unsubscribe(){}}}}; },
      signInWithOtp: async args => { calls.login.push(args); return {error:null}; },
      signOut: async () => { currentUser=null; listener('SIGNED_OUT', null); return {error:null}; },
    },
    from: table => {
      const query = {
        select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},abortSignal(){return this;},
        maybeSingle: async () => { calls.profile++; return {data:currentProfile,error:null}; },
        then(resolve,reject) { return Promise.resolve({data:[],error:null}).then(resolve,reject); },
      };
      return query;
    },
    rpc: (name, args) => {
      const result = (async () => {
      if (name === 'evolution_is_admin') return {data:false,error:null};
      if (name === 'evolution_register') {
        calls.register.push(args);
        if (registerError) return {error:{message:'Registration is temporarily unavailable'}};
        currentProfile = {id:user.id,name:args.display_name,email:user.email,role:args.account_role,job_notifications:args.account_role === 'developer'};
        return {data:currentProfile,error:null};
      }
      if (name === 'evolution_post_job') { calls.post.push(args); published=true; return {data:'new-request-id',error:null}; }
      throw Error(`Unexpected RPC ${name}`);
      })();
      result.abortSignal = () => result;
      return result;
    },
  };
  w.__testSupabase = client;
  w.fetch = async url => { assert.ok(String(url).startsWith('/api/')); calls.fetch++; return {ok:true,headers:{get:()=> 'application/json'}}; };
  if (pending) w.localStorage.setItem('evolution:pending-signin:v1', JSON.stringify({savedAt:Date.now(),...pending}));
  if (savedDraft) w.localStorage.setItem('evolution:request-draft:v2', JSON.stringify({savedAt:Date.now(),values:savedDraft}));
  w.eval(bundle.outputFiles[0].text);
  await until(() => w.document.querySelector('header'), 'mount');
  const form = () => w.document.querySelector('form');
  const signIn = (next = user) => { currentUser=next; listener('SIGNED_IN',{user:next}); };
  const fill = fields => {
    for (const [key,value] of Object.entries(fields)) {
      const input = form().elements.namedItem(key);
      assert.ok(input, `Missing ${key}`);
      input.value=value;
      input.dispatchEvent(new w.Event('input',{bubbles:true}));
    }
  };
  const submit = () => form().dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {w,calls,form,signIn,fill,submit,close:()=>dom.window.close()};
}

// Returning users skip the login form, including a reload on ?action=login.
{
  const t=await mount({sessionUser:user,action:'login'});
  await until(()=>t.w.location.search === '', 'remembered user resumes board');
  assert.match(t.w.document.body.textContent,/owner@example.com/);
  assert.equal(t.calls.login.length,0);
  t.close();
}
// Draft is saved before submitting. Verification in another tab restores it;
// repeat auth events must not reload the profile or wipe a filled form.
{
  const t=await mount({notifyError:true});
  await until(()=>t.form(),'guest post form');
  t.fill(draft);
  await until(()=>JSON.parse(t.w.localStorage.getItem('evolution:request-draft:v2')).values.title === draft.title,'draft persisted while typing');
  t.submit();
  await until(()=>t.calls.login.length === 1,'verification requested');
  assert.equal(t.calls.post.length,0);
  t.signIn();
  await until(()=>t.form()?.textContent.includes('Publish Request'),'verified posting form');
  assert.equal(t.form().elements.namedItem('title').value,draft.title);
  assert.equal(t.form().elements.namedItem('contact_email').value,draft.contact_email);
  const profileCalls=t.calls.profile;
  t.signIn({...user});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(t.calls.profile,profileCalls);
  t.submit(); t.submit();
  await until(()=>t.w.document.body.textContent.includes('Your agent request is live.'),'publication confirmation');
  assert.equal(t.calls.post.length,1);
  assert.equal(t.calls.post[0].draft.title,'Daily stock report');
  assert.equal(t.calls.post[0].draft.budget,100);
  assert.equal(t.calls.register[0].account_role,'business');
  assert.equal(t.w.localStorage.getItem('evolution:request-draft:v2'),null);
  assert.equal(t.w.document.querySelector('[role=alert]'),null);
  t.close();
}
// Redirect allowlists sometimes fall back to /. Restore only matching verified
// intent, without silently publishing or auto-registering an old builder role.
{
  const t=await mount({sessionUser:{...user,user_metadata:{evolution_role:'developer',evolution_name:'Old name'}},action:'board',pending:{email:user.email,action:'post',name:'Owner'},savedDraft:draft});
  await until(()=>t.form()?.textContent.includes('Publish Request'),'fallback callback restores posting');
  assert.equal(t.w.location.search,'?action=post');
  assert.equal(t.form().elements.namedItem('description').value,draft.description);
  assert.equal(t.calls.register.length,0);
  assert.equal(t.calls.post.length,0);
  t.close();
}
// Existing Auth users need not have signup metadata: joining still completes.
{
  const t=await mount({sessionUser:user,action:'board',pending:{email:user.email,action:'join',name:'Agent Builder'}});
  await until(()=>t.w.document.body.textContent.includes('You’re registered.'),'existing auth user registers builder');
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls.register[0])),{display_name:'Agent Builder',account_role:'developer'});
  t.close();
}
// Failed registration never publishes and retains the request for retry.
{
  const t=await mount({sessionUser:user,savedDraft:draft,registerError:true});
  await until(()=>t.form(),'signed-in form');
  t.submit();
  await until(()=>t.w.document.querySelector('[role=alert]'),'registration error displayed');
  assert.equal(t.calls.post.length,0);
  assert.equal(t.form().elements.namedItem('title').value,draft.title);
  assert.ok(t.w.localStorage.getItem('evolution:request-draft:v2'));
  t.close();
}
// A delayed initial session response cannot overwrite a newer auth event.
{
  let resolveInitial;
  const t=await mount({action:'login',initialSession:new Promise(resolve=>{resolveInitial=resolve;})});
  t.signIn();
  await until(()=>t.w.location.search === '', 'new sign-in wins');
  resolveInitial({data:{session:null},error:null});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.match(t.w.document.body.textContent,/owner@example.com/);
  t.close();
}
console.log('PASS: remembered login, cross-tab verification, redirect fallback, stable refresh, guarded publication, registration recovery and auth races. No live emails or posts.');
