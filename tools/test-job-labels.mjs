import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/jobs/labels.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { agentTypeForJob, formatMonthlyBudget, requestSummary } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

for (const [title, expected] of [
  ['Send a daily shortlist of junior developer jobs in India', 'Job search agent'],
  ['Find matching internships', 'Job search agent'],
  ['Answer customer support tickets', 'Customer support agent'],
  ['Send a daily product stock report', 'Inventory agent'],
  ['Find sales leads', 'Sales agent'],
  ['Schedule social media posts', 'Marketing agent'],
  ['Draft product descriptions', 'Writing agent'],
  ['Process invoices', 'Finance agent'],
  ['Summarize spreadsheets', 'Data agent'],
  ['Research competitors', 'Research agent'],
  ['Handle a recurring task', 'Custom AI agent'],
  ['Apply tags to supportable items', 'Custom AI agent'],
]) assert.equal(agentTypeForJob(title), expected, title);

assert.equal(formatMonthlyBudget(null), 'Budget not set');
assert.equal(formatMonthlyBudget(0), '$0.00/month');
assert.equal(formatMonthlyBudget(100), '$100.00/month');
assert.equal(formatMonthlyBudget(125.5), '$125.50/month');
assert.equal(requestSummary('A short\n\nclear request.'), 'A short clear request.');
const summary = requestSummary('A detailed request with meaningful context. '.repeat(12));
assert.ok(summary.length <= 180);
assert.ok(summary.endsWith('…'));
console.log('PASS: task-specific agent labels, neutral unknown type and factual monthly budgets.');
