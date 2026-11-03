import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('src/jobs/signin.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const helpers = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
const draft = { requester_name: 'Example', title: 'Daily report', description: 'Prepare an inventory report each day for review.', email: 'owner@example.com', contact_email: 'public@example.com', budget: '100', frequency: 'Daily' };
helpers.saveRequestDraft(storage, { ...draft, access_token: 'must-not-save' }, 1000);
assert.deepEqual(helpers.readRequestDraft(storage, 2000), draft);
assert.equal(JSON.stringify([...values]).includes('must-not-save'), false);
assert.deepEqual(helpers.readRequestDraft(storage, 86401001), {});
helpers.saveRequestDraft(storage, draft, 1000);
helpers.clearRequestDraft(storage);
assert.deepEqual(helpers.readRequestDraft(storage, 2000), {});
helpers.savePendingSignIn(storage, ' Owner@Example.com ', 'post', 'Owner', 1000);
assert.deepEqual(helpers.readPendingSignIn(storage, 'owner@example.com', 2000), {email:'owner@example.com',action:'post',name:'Owner'});
assert.equal(helpers.readPendingSignIn(storage, 'other@example.com', 2000), null);
assert.equal(helpers.readPendingSignIn(storage, 'owner@example.com', 3601001), null);
helpers.clearPendingSignIn(storage);
assert.equal(helpers.readPendingSignIn(storage, 'owner@example.com', 2000), null);
assert.equal(helpers.requestPayload({...draft, title:'  Daily report  ', budget:'10.01'}).title, 'Daily report');
assert.equal(helpers.requestPayload({...draft, budget:'10.01'}).budget, 10.01);
for (const invalid of [{title:'    '}, {description:' '.repeat(45)}, {frequency:'Hourly'}, {budget:''}, {budget:'NaN'}, {budget:'10.123'}]) {
  assert.throws(() => helpers.requestPayload({...draft,...invalid}));
}
for (const action of ['login', 'join', 'post']) {
  const options = helpers.emailSignInOptions('https://www.runevolution.io', `?action=${action}&access_token=not-forwarded`, 'developer', 'Example');
  assert.equal(options.shouldCreateUser, true);
  assert.equal(options.emailRedirectTo, `https://www.runevolution.io/?action=${action}`);
  assert.equal(options.data.evolution_role, 'developer');
}
assert.equal(helpers.emailSignInOptions('https://www.runevolution.io', '?action=apply&job=example').emailRedirectTo, 'https://www.runevolution.io/?action=apply&job=example');
assert.equal(helpers.signInCallbackError('', ''), '');
assert.match(helpers.signInCallbackError('', '#error=access_denied&error_code=otp_expired'), /expired/);
assert.match(helpers.signInCallbackError('?error=access_denied', ''), /new link/);
const app = fs.readFileSync('src/jobs/main.tsx', 'utf8');
assert.match(app, /saveRequestDraft\(localStorage, data\)/);
assert.match(app, /readRequestDraft\(localStorage\)/);
assert.match(app, /clearRequestDraft\(localStorage\)/);
assert.match(app, /setAuthReady\(true\); \} \}\)/);
console.log('PASS: new-email login, safe redirects, cross-tab draft recovery, expiry, cleanup and callback errors.');
