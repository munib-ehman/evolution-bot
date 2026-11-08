# Nova by Evolution — Evolution v4 MVP

Nova is a business operator managed through WhatsApp. The monthly subscription is USD 200. Signup is the only customer web screen. Ongoing setup, instructions, decisions and reports happen in the conversation, with official account-authorization links where required.

## Implemented journey

| Step | Implemented behavior |
| --- | --- |
| Subscribe | The owner enters their WhatsApp number and consents to service messages. Stripe-hosted checkout uses a verified fixed USD 200/month price. |
| Welcome | A verified paid webhook provisions the owner account and queues a Meta-approved welcome template from the shared Nova contact. |
| Talk about the business | A guided interview asks what the business sells, its desired outcome, tools, process, bottlenecks and current inquiry-handling effort. Text, voice notes and a Twilio telephone interview are supported by adapters. |
| Share information | Owner document attachments import conversation exports and business information. Imports are private until explicitly shared for customer replies. |
| Connect tools | An owner-requested Google authorization link connects Calendar. Other tools use administrator-configured business integration endpoints. |
| Choose an opportunity | Nova recommends supported inquiry, follow-up and quote workflows, with baseline-based time estimates and honest cost unknowns. |
| Build and review | A reviewed recipe is configured, demonstrated on an owner sample and activated only after explicit approval. |
| Operate | Persistent queues execute actions under owner rules. Pause/resume, approvals, lead records, quotes and local bookings are available. |
| Improve and report | Weekly reports use recorded task states, quote/booking records and available model-usage evidence. Suggestions prioritize failed actions and approval backlogs. |
| Manage subscription | A WhatsApp billing command returns a private Stripe portal link. Inactive or expired subscriptions stop execution. |

## First supported workflows

The travel and detailing pilots share a common core. Inquiries collect requirements and prepare responses using explicitly shared business material. Lead records, quotes and local bookings are created through permission-gated tools. The follow-up recipe schedules one check four hours after an inquiry and cancels when a customer replies, opts out or has a recorded booking.

A locally recorded booking does not reserve a flight, hotel or supplier service, charge a customer or establish revenue. A Google Calendar event is a separate approved action. Travel inventory and ticketing require their real supplier integrations. Arbitrary product/code generation is not implemented by the recipe builder.

## Owner controls

Owner messages include PAUSE, RESUME, REPORT, CALL ME, CONNECT CALENDAR, RECOMMEND, BUILD inquiries/followups/quotes, ACTIVATE WORKFLOW and BILLING. Ordinary approval phrases work when exactly one action awaits review. Multiple actions require their IDs. Supported natural rule instructions include asking before bookings, quotes or calendar changes and enabling automatic customer replies. Default permissions require approval.

The onboarding call is proposed to the owner and requires approval before an outbound call is initiated. Calls use Twilio telephone service with speech turns; WhatsApp-native live calling is not implemented.

## Usage and cost controls

A conservative monthly token reservation guard limits AI usage. Provider-reported model tokens are persisted when supplied. Configured per-million rates estimate model cost, with separate rates for an optional cheaper customer model. Shorter customer outputs and bounded retrieval reduce model usage.

The $200 subscription has no automatic overage billing. Complete dollar cost reconciliation, measured staff-time savings and an agreed commercial allowance require real pilot measurements. WhatsApp/SMS, voice, transcription, hosting and other provider charges remain excluded from model-only estimates and are labelled unknown. Time savings shown during setup are assumptions to test, not measured results.

## Verification

105 local tests pass, including checkout verification, repeat/concurrent checkout handling, duplicate and out-of-order payment events, subscription expiry, signed webhooks, business isolation, owner approvals, sample review/activation, scheduled follow-up cancellation, model-usage records and paid-to-onboarding progression. Providers are simulated in these tests. Python compilation and diff checks pass.

## Live setup still required

- An authorized Stripe account with the USD 200 monthly price, webhook signing secret and configured customer portal.
- Meta developer app/test-number access, messaging credentials, and approved welcome/report templates.
- An AI provider account and selected model/transcription configuration.
- Twilio credentials and an authorized phone number for calls or optional SMS.
- A Google OAuth application and persistent encryption key for Calendar.
- A persistent cloud server and worker, plus customer-facing business-channel connections.

No live payment, message, authorization or call was performed by the local tests. The detailer's actual US number provider still needs identification. Production account provisioning, encrypted backups and data retention/deletion procedures require deployment work. The existing public site remains the v3 marketplace until a separate deployment decision.
