import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function sourceModule(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
}
const { contactHref, requestContacts, validateContacts } = await sourceModule('../src/jobs/contacts.ts');
assert.deepEqual(requestContacts({}), []);
assert.equal(contactHref('contact_email', 'person@example.com'), 'mailto:person%40example.com');
assert.equal(contactHref('contact_email', 'person@example.com\r\nBcc:other@example.com'), null);
assert.equal(contactHref('contact_linkedin', 'https://linkedin.com.evil.example/in/person'), null);
assert.equal(contactHref('contact_linkedin', 'https://www.linkedin.com/in/person?utm_source=test'), 'https://www.linkedin.com/in/person');
assert.equal(contactHref('contact_x', 'https://x.com/home'), null);
assert.equal(contactHref('contact_x', 'https://twitter.com/person'), 'https://twitter.com/person');
assert.equal(contactHref('contact_url', 'javascript:alert(1)'), null);
assert.equal(contactHref('contact_url', 'https://localhost/contact'), null);
assert.equal(contactHref('contact_url', 'https://127.0.0.1/contact'), null);
assert.equal(contactHref('contact_url', 'https://user:password@example.com/contact'), null);
assert.equal(contactHref('contact_url', 'https://example.com/#contact'), 'https://example.com/#contact');
assert.throws(() => validateContacts({}), /at least one/);
assert.throws(() => validateContacts({ contact_x: 'https://example.com/person' }), /valid X/);
const contacts = validateContacts({ contact_email: ' Person@Example.com ', contact_linkedin: 'https://www.linkedin.com/in/person', contact_x: 'https://x.com/person' });
assert.equal(contacts.contact_email, 'person@example.com');
assert.deepEqual(requestContacts(contacts).map(contact => contact.label), ['Email', 'LinkedIn', 'X']);
assert.equal(requestContacts({ contact_email: 'bad', contact_x: 'https://x.com/person' }).length, 1);
const { exampleRequests } = await sourceModule('../src/jobs/examples.ts');
const { agentTypeForJob } = await sourceModule('../src/jobs/labels.ts');
assert.equal(exampleRequests.length, 10);
assert.equal(new Set(exampleRequests.map(request => request.id)).size, 10);
assert.equal(new Set(exampleRequests.map(request => agentTypeForJob(request.title))).size, 10);
for (const request of exampleRequests) {
  assert.equal(request.example, true);
  assert.equal(request.status, 'Example');
  assert.equal(request.created_at, '');
  assert.equal(requestContacts(request).length, 0);
  assert.ok(request.title.length <= 100);
  assert.ok(request.description.length >= 40 && request.description.length <= 1200);
  assert.ok(request.monthly_budget >= 10 && request.monthly_budget <= 200);
}
console.log('PASS: public opt-in contacts, safe profile links, no private login-email fallback, ten distinct explicitly illustrative briefs.');
