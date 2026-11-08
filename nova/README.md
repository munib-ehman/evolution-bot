# Nova by Evolution — v4 backend

Python 3.11 or later. Install the dependency in requirements.txt for encrypted Google connection tokens. Read MVP.md for product scope and current limits.

## Local setup

Run these commands from this directory. The example identifiers are placeholders. No actual messages are sent until provider credentials are configured and a worker runs a delivery action.

```sh
python3 -m pip install -r requirements.txt
python3 nova.py business travel 'Travel pilot' 15555550101 META_PHONE_NUMBER_ID
python3 nova.py import travel /absolute/path/approved-chat-export.txt
python3 nova.py import travel /absolute/path/current-packages.txt --customer-safe
python3 nova.py serve
```

In a second terminal with the same environment and working directory, run the worker.

```sh
python3 nova.py worker
```

Set variables from .env.example in the process environment. The application does not automatically load .env files. Do not reuse a personal Google app password or any unrelated credentials. A missing AI configuration makes AI requests fail explicitly. It does not enable a simulated model.

Queue a local owner instruction and inspect saved results.

```sh
python3 nova.py message travel 'Which packages fit a family of four?'
python3 nova.py state travel
python3 nova.py message travel 'RULE remember auto'
python3 nova.py message travel 'APPROVE ACTION_ID'
python3 nova.py message travel 'REPORT'
```

Valid tools are remember, schedule, send_message, connector, save_lead, prepare_quote, confirm_booking and calendar_event. Every tool defaults to approve. Rules are auto, approve and deny. Existing approved tasks retain their approval when the default rule changes, except deny also blocks queued execution.

For the administrator-only local API, set NOVA_ADMIN_TOKEN and send an Authorization Bearer header to POST /local/message with business and text, or GET /local/state?business=travel. These endpoints are development tools, not a customer dashboard.

## Business integrations

Use a local JSON file to configure explicit integration endpoints and policy. Each endpoint must implement its own business-specific validation and should honor the Idempotency-Key header. The administrator controls endpoint destinations. Never put API secrets in imported documents or agent messages.

```json
{
  "monthly_token_limit": 500000,
  "rules": {"remember": "approve", "schedule": "auto", "send_message": "approve", "connector": "approve"},
  "connectors": {
    "prepare_quote": {
      "url": "https://your-authorized-service.example/prepare-quote",
      "token_env": "TRAVEL_CONNECTOR_TOKEN"
    }
  }
}
```

```sh
python3 nova.py configure travel business-config.json
```

## Provider endpoints

WhatsApp verification and incoming events use GET and POST /webhooks/whatsapp. Signatures use META_APP_SECRET. Configure Meta to send message events and provide the currently supported META_GRAPH_VERSION. The sender matching the stored owner is authorized to direct Nova. Other senders become customer messages and generate reply proposals under the owner’s send_message rule. Only documents explicitly imported with --customer-safe are supplied to customer reply planning. Do not share the owner's WhatsApp account.

Twilio incoming voice uses POST /webhooks/call. Configure NOVA_PUBLIC_URL to the exact HTTPS origin used by Twilio, TWILIO_AUTH_TOKEN and NOVA_CALL_BUSINESS. Only the registered owner caller is accepted in this pilot adapter. Speech turns are queued and polled while the worker prepares a response. Live call quality and latency need provider testing.

WhatsApp freeform messages require a recent inbound session. Set WHATSAPP_REPORT_TEMPLATE to an approved template with one body parameter containing the report and WHATSAPP_REPORT_LANGUAGE to its approved language code. This enables weekly reports outside an active session. A failed or ambiguous delivery stays visible in state. Reconcile it with the provider before any manual retry. Owner calls and local messages do not extend a WhatsApp session.

## Hosting

Run the HTTP server and one worker against the same persistent SQLite volume on a single host. Dockerfile packages either process. Use a process manager to restart both, terminate TLS at a trusted reverse proxy and back up the data volume. This first database architecture does not support independent replicas with separate disks.

Local execution requires this computer to remain running. No cloud deployment or billing is configured by these files.

## Verification

```sh
python3 -m unittest discover -s tests -v
```

Tests use temporary databases and simulated AI/provider responses. They exercise the actual worker and permission logic without contacting customers or incurring API charges.

## Conversation onboarding

New businesses start in setup. The first owner message receives a welcome question. Nova collects the business description, first responsibility and supplied information, asks the owner to choose approval mode, prepares a sample reply and requires ACTIVATE before customer replies run. Existing database businesses retain their prior active state. Send SETUP to start onboarding for one of those businesses.

Send .txt, .csv or .json exports as WhatsApp document attachments. The authenticated owner can import them directly. Imports remain private until the owner sends SHARE followed by the exact file name. Customer-facing retrieval excludes private documents and other customers’ conversations.

Useful owner messages include PAUSE, RESUME, REPORT, USAGE, APPROVE LATEST (when exactly one proposal is pending), APPROVE followed by an action ID and CONNECT CALENDAR. Tool policy changes use RULE followed by the tool name and auto, approve or deny. Pause holds execution of queued actions and incoming customer tasks. Resume releases held work through the current permission gate. Disabling a tool also blocks held actions.

The lead, quote and booking tools store records within the business. Quotes require an existing lead and explicit currency/amount. A local booking uses an approved quote and explicit dates, checks against overlapping Nova bookings, and does not reserve supplier inventory, take payment or issue travel tickets. Google Calendar events are separate actions with their own approval. All summaries distinguish local records from external confirmation.

## Google Calendar connection

Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for your Google OAuth application. Set NOVA_TOKEN_ENCRYPTION_KEY to a stable Fernet key in the host’s secret manager. Register NOVA_PUBLIC_URL plus /connections/google/callback as the redirect URL. The owner requests CONNECT CALENDAR in WhatsApp and consents on Google’s page. The callback consumes an expiring one-time state, encrypts tokens and privately confirms the connection. Access is to primary-calendar events. Actions remain subject to owner rules after account consent.

## Optional Twilio SMS

Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. Add sms_number in a business configuration file using +country-code format, and register POST /webhooks/sms as that number’s incoming webhook. Signed inbound texts are routed to that business, deduplicated and processed under its approval rules. Replies return through SMS. Owner control remains in WhatsApp. This adapter does not connect an arbitrary US number provider; the detailer’s provider and transfer/integration options still need verification.

## Production boundary

Live WhatsApp, SMS, Google and call credentials remain required. Tests simulate provider responses and do not establish real delivery, AI output quality or cloud uptime. SMS STOP requests suppress further outbound messages. Proactive WhatsApp follow-ups outside an active session still require an approved template integration. This backend has no checkout or subscription collection. Dollar cost metering and a commercial usage allowance are still pending; the token reservation guard is only an internal conservative limit.

## Paid signup and automatic welcome

The Nova server now serves /signup. It collects the owner’s international WhatsApp number and explicit consent, then creates a Stripe-hosted subscription checkout for USD 200/month. NOVA_STRIPE_PRICE_ID must point to an active fixed monthly USD 200 price. Configure NOVA_STRIPE_SUCCESS_URL and NOVA_STRIPE_CANCEL_URL to the public /signup/complete and /signup/cancel URLs. Enable the hosted Stripe billing portal for owner subscription management.

POST /webhooks/stripe verifies signatures and reconciles payment/subscription status against Stripe before provisioning. A browser success redirect cannot activate an account. Duplicate events cannot create extra accounts or welcome messages. Past-due/cancelled/expired subscriptions stop execution. Reinstatement returns prior approved actions for fresh review. Legacy pilot accounts without billing settings retain their existing behavior.

NOVA_WHATSAPP_PHONE_ID is the shared Nova contact number. Paid owners are routed by their WhatsApp sender number and the operator phone ID. Customer-facing merchant numbers remain separate business connections. Configure WHATSAPP_WELCOME_TEMPLATE to a Meta-approved zero-parameter welcome template asking the owner what they sell and who their customers are. Signup consent is recorded locally; Meta account verification and any sender onboarding must be configured separately. If no welcome template is configured, delivery waits. Restart the worker after configuring it to release waiting welcomes.

The owner can say BILLING or CANCEL SUBSCRIPTION to receive a private Stripe-hosted management link. Cancellation/payment-method changes happen on that provider page. Stripe credentials and a configured account are required. No live Stripe integration, prices, templates or billing resources were provisioned during implementation.

## Detailed interview, recommendations and assembly

Paid users start a detailed interview covering business description, desired work, existing tools, the current process, bottlenecks and baseline inquiry volume/handling time. They can answer through text, voice notes or an approved onboarding call. CALL ME proposes an outbound call to their registered number; approval uses the normal action gate. NOVA_CALL_FROM_NUMBER and Twilio credentials are required. The existing call endpoint conducts the interview in turns. WhatsApp-native live calling is not implemented.

After setup review, Nova suggests three supported workflow recipes: inquiries, followups and quotes. RECOMMEND or OPTIMIZE shows them again. BASELINE 40 10 records 40 weekly inquiries at 10 staff minutes each. Savings are explicitly estimates, not measured performance or guaranteed revenue.

BUILD inquiries, BUILD followups or BUILD quotes prepares a recipe. Nova requests a customer sample, provides a practice reply and waits for ACTIVATE WORKFLOW. A customer-safe business document must be present before activation. Inquiry workflows propose lead records and customer replies. The follow-up recipe creates one future check after four hours, cancelled when the customer replies, opts out or has a recorded booking. Existing approval rules still apply. Proactive customer templates beyond the active WhatsApp session are not part of this recipe.

This is configuration of reviewed recipes, not arbitrary code generation or deployment. Quotes are recorded under owner approval; supplier availability, travel ticketing and payments need their corresponding real integrations. The weekly report adds the next improvement based on failures or approval backlogs.

## Cost and time evidence

Provider-reported model token usage is saved when present. Configure current per-million input/output rates to estimate that portion of cost. NOVA_CUSTOMER_AI_MODEL can select a cheaper model for customer replies, with separate rates. Customer responses have a shorter output limit, and retrieval bounds supplied context. Model dollar estimates exclude voice, WhatsApp/SMS, hosting and third-party tools; unknown charges remain labelled unknown. Token reservation limits still enforce the internal AI allowance. The fixed Stripe subscription does not automatically bill overages.

Full production cost reconciliation, measured staff-time tracking and optimizing arbitrary third-party workflows still need deployment evidence. Recommendations are grounded in the owner’s baseline and recorded task states; they are never represented as proven savings.

## Hosted signup and backend connection

`preview/` now publishes the short signup page and a server-side bridge. The shared signup renderer is `preview/signup_template.py`; `signup.py` imports it for the persistent server. Run `python3 preview/build.py` to generate public pages. The old scripted conversation is available explicitly at `/demo.html`.

Set `NOVA_BACKEND_URL` on the website project to the persistent server's HTTPS origin. Set `NOVA_PUBLIC_URL` on the persistent server to the public website origin. The bridge forwards only signup, public availability, signed Stripe/WhatsApp/Twilio callbacks, and the Google callback. Original webhook bytes and signature headers are preserved. Private administration routes are not forwarded. The website never receives payment card details.

Configure Stripe success/cancel URLs to the public website's `/signup/complete` and `/signup/cancel`. Configure provider callbacks at the public website's `/webhooks/stripe`, `/webhooks/whatsapp`, `/webhooks/call`, `/webhooks/sms`, and `/connections/google/callback` as applicable. The backend must remain one server plus one worker with a shared persistent database. Vercel's website functions do not run the SQLite worker.

`GET /public/status` exposes only whether checkout is open and a short public message. Checkout requires core provider settings, a worker heartbeat within 120 seconds, and `NOVA_ACCEPT_SIGNUPS=true`. Keep that launch flag false until the actual provider flow passes. Optional voice/Calendar need their respective provider accounts before use. No configuration-only check proves external delivery works.

Before activating checkout, verify a real provider test flow and configured usage allowance, ensure a durable database/backups, and then set the launch flag. With no backend, the live website returns setup-pending and does not submit phone details or collect payment.

Run the website connection checks with `node --test preview/test-bridge.mjs`. They cover raw signed webhook forwarding, route restrictions, callback queries and unavailable-backend handling.
