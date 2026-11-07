# Evolution v4 — Nova

Nova is an AI business operator managed through WhatsApp text, voice notes and phone calls. The proposed base subscription is $200 per month with a measured usage allowance. This implementation does not collect payment.

The owner supplies business information and chooses which tools can run automatically, which need approval and which are disabled. Nova uses server-side memory, planning, persistent tasks and configured business integrations to act on those instructions.

## Implemented first backend

- Business-isolated SQLite storage for imported UTF-8 conversations and business documents, recent messages, tasks, proposals and action results.
- A configurable AI provider using the Chat Completions protocol. Retrieval supplies source-labelled passages and recent conversation context. Imports do not retrain the underlying model.
- Signed WhatsApp Cloud API webhooks, durable inbound message deduplication, customer reply proposals and queued replies. Customer replies follow the owner’s send_message rule.
- Voice-note retrieval and a configurable transcription connection.
- A signed Twilio inbound phone-call flow with speech collection, background planning and spoken responses. This is a turn-based voice prototype and needs live latency testing.
- Owner commands for approval, rejection and tool-level permission changes.
- Tools for saving a business fact, scheduling a task, sending WhatsApp messages and invoking explicitly configured HTTPS integrations.
- Weekly reports built from recorded actions. Proactive delivery uses a configured Meta-approved template outside an active session. If no template is configured, the report waits for the owner’s next inbound WhatsApp message.
- One worker per database, atomic claims, and uncertain delivery states requiring reconciliation rather than automatic resends.
- A conservative AI token admission allowance. This is not dollar metering or a profitability calculation.

## Pilot path

Create separate travel and detailing business records. Import approved chat exports, catalog information and current business rules. Connect the business's official messaging channel. A Nova number must be assigned per business in this first version because inbound customer messages route by phone-number ID.

Ask Nova to retrieve information, save rules, prepare work, schedule follow-ups and use configured integrations. The owner reviews the exact action and arguments before approving. Permission changes are explicit owner commands.

The general operator accepts broad requests. Its executable capabilities come from the tool registry and business connectors. Novel work needs an integration or builder implementation. Arbitrary shell access is not part of this first backend.

## Required before a real customer pilot

Supply authorized Meta credentials and phone-number ID, an AI provider key and selected models, and a cloud host with persistent storage. Live calls additionally need a Twilio number, credentials and public webhook URL. The existing US texting provider still needs identification and its own adapter.

Test actual messages, voice notes and calls on the authorized numbers. Verify current provider permissions, supported account setup and costs. Do not treat a WhatsApp connection as blanket access to a personal inbox or historical chats. Historical exports must be supplied or synchronized through an officially supported onboarding flow.

Configure an approved report template, exact usage/cost accounting, subscription billing, encrypted backups and a tested data deletion/retention process before commercial rollout. Customer messages produce reply proposals; send_message auto allows replies without individual approval. Customers cannot invoke administrative tools or choose other recipients. Documents supplied to customers must be explicitly imported with --customer-safe. Historical chat imports remain private owner context by default.

## Acceptance checks

1. A real WhatsApp owner message receives a relevant response using that business's supplied material.
2. Duplicate inbound delivery produces one queued task.
3. A proposed external action waits until the authenticated owner approves its exact content.
4. An approval from another business cannot unlock that action.
5. A disabled tool cannot execute. An ambiguous provider result is recorded without a resend.
6. A scheduled task survives service restart and runs once through the same permission gate.
7. The weekly report reflects stored action states. Bookings and revenue are only reportable after a connected system provides them.

The backend has automated local checks for core behavior. Provider delivery and real-business outcomes require configured pilot accounts and have not been verified by those checks.

## November 8 implementation update

Conversation onboarding, owner file imports, a practice-response review and explicit activation are now implemented. Customer replies wait for activation. Pause/resume applies to customer tasks, scheduled work and approved actions. Reports include prepared quotes, locally recorded bookings and conservative AI allowance consumption.

The travel and detailing pilots share business-isolated lead, quote and booking records. Google Calendar has an owner-requested OAuth connection and approval-gated event creation with encrypted tokens. A signed Twilio SMS adapter supports customer texts when the business uses a configured Twilio number. The detailer’s actual provider is still unknown.

These additions remain locally verified. The supported action set is finite. Live supplier booking, payments, arbitrary tool onboarding, subscription collection and cloud/provider activation remain outside the completed functionality. Current live call support is inbound owner calls through Twilio; WhatsApp-native live calls and outbound calling are not implemented.
