---
title: Relevance AI Marketplace: what to check before cloning an agent
description: Evaluate a Relevance AI Marketplace agent by its tools, connected accounts, expected output, approval boundaries and ownership of recurring operation.
slug: relevance-ai-marketplace-clone-checklist
date: 2026-10-29
---

Cloning an agent from Relevance AI Marketplace can provide a starting configuration. It does not remove the need to connect the right accounts, inspect the tools and decide what a successful result looks like for your business.

Relevance AI's documentation describes a marketplace containing pre-built agents and tools that can be cloned and customized. Its setup guidance includes reviewing prompts, tools, settings and integrations after cloning. That is a configuration process, not proof that a marketplace item is already operating correctly in your account. [Relevance AI quick start](https://relevanceai.com/docs/get-started/quick-start-guide).

## Check whether the listing is an agent or a tool

The platform distinguishes agents, tools and workforces. A tool can provide an action inside a larger system; an agent can use tools toward a task; a workforce combines multiple agents. Read what the particular item supplies instead of treating those terms as interchangeable. [Relevance AI's product introduction](https://relevanceai.com/docs/get-started/introduction).

This matters when you want an outcome such as a weekly competitor briefing. A web-search tool might be useful, but it is not the entire briefing process. Someone still has to define the questions, permitted sources, output format and review step.

## Review connected accounts before giving access

List every system the cloned configuration expects to read or change. Separate account connection from permission to take an action. An account may support reading information, creating records or sending messages, but your task may need only one of those abilities.

For a hypothetical meeting-preparation agent, read-only access to an approved CRM view may be sufficient. Permission to edit every deal or email every contact would be a separate decision, not a harmless default.

Use the smallest supported permission set that fits the task. If the setup requires broader access than expected, ask why before connecting live business data.

## Replace the sample task with a checkable business outcome

A generic instruction such as "research this company" is difficult to evaluate. Specify the decision the output should help with and the evidence it must include.

For example, a hypothetical briefing could require five recent company facts with source links and observation dates, a separate list of unanswered questions and a one-paragraph summary for a sales call. It should explicitly avoid guessing private financial figures or inventing contact details.

Keep the acceptance criteria independent of the marketplace description. That lets you compare the actual result with the business requirement rather than deciding the task worked because the agent produced fluent text.

## Test normal inputs and awkward ones

Use permitted, non-sensitive examples first. Test a company with a clear official website, an ambiguous name and a case with little public information. Ask whether the output distinguishes an unavailable fact from a negative finding.

Check where external information enters the workflow. A retrieved webpage or document should be treated as source material, not as authority to change the agent's permissions or destination. Unexpected instructions in retrieved content are a reason to review the result, not to follow them automatically.

## Decide who owns the recurring work

If the first test succeeds, define when the task runs and who handles failures. Clarify who maintains the connected accounts, checks cost limits and approves changes to the configuration. A marketplace clone is not the same agreement as a managed monthly outcome.

Also specify the stop condition. If a required source becomes unavailable, should the agent send a partial briefing with a warning, skip delivery or request a human review? An explicit answer is better than a silent empty report.

## Keep a small before-and-after record

Save the original listing link, your customized instructions, connected tools, permitted actions and a sample accepted output. When you change a prompt or tool later, rerun the same small evaluation set so you can see what improved and what regressed.

The practical decision is not whether cloning is easy. It is whether you can operate the resulting configuration within a clear task boundary and verify its output. For the next review, use the [permissions checklist](/guides/ai-agent-permissions-checklist) and [recurring handover checklist](/guides/recurring-ai-agent-handover).
