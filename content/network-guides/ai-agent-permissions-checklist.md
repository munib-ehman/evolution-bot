---
title: An AI agent permissions checklist for a small business
description: Decide what an agent may read, draft or change, and define expiration, limits and a practical way to stop access.
slug: ai-agent-permissions-checklist
date: 2026-10-26
---
Before connecting an AI agent to your business, ask what it actually needs to do. Reading an export, drafting a reply and sending that reply require different permissions. Treating them as one broad integration makes a small trial harder to control.

You do not need a complicated security program to ask clear questions. You do need a named owner, a limited scope and a working way to stop access. The checklist below is a planning aid, not a security certification.

## Write the permitted action in one sentence

For example: “Read this week's anonymized support export and return a topic summary.” That task does not require access to your live inbox or permission to send messages.

If an integration is necessary, ask the builder to list the exact data and actions it requires. Distinguish reading records from creating, updating and deleting them. “Full access makes setup easier” is not an explanation of why a task needs it.

OWASP recommends [least-privilege tool access and independent checks on consequential actions](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html). In practical terms, give a reporting task reporting access rather than store administration access.

## Agree on five boundaries

- Data: which records and fields may the agent use?
- Actions: what may it read, draft or change?
- Volume: how many records or actions are allowed per run?
- Duration: when should access expire or be reviewed?
- Destination: where may the output go, and who may see it?

Treat these as enforced controls where your tools support them, not merely words in a prompt. If a service cannot restrict access narrowly enough, use a reduced export or choose a different pilot.

## Decide what happens outside the boundary

Specify a stop condition for unexpected data, missing credentials or a request to perform a new kind of action. The agent should report the problem instead of quietly expanding its scope.

For an autonomous low-risk workflow, the boundary can permit routine actions without repeated approval. That does not require allowing unrelated actions. A system can work independently inside a small box and stop when it reaches the edge.

## Test the stop button before relying on it

Ask who can revoke access and where that control lives. Run a harmless test: stop the integration and confirm that the next scheduled run cannot continue using old access. Keep enough logs to identify which records were affected, without unnecessarily retaining private content.

Do not post passwords or access tokens in a public request or send them through an ordinary feed message. Use the service's supported connection process. When the trial ends, remove access that is no longer needed and agree how shared copies of data are handled.

Review these boundaries again whenever the job changes. A successful read-only pilot is evidence about that pilot, not automatic permission for live edits.
