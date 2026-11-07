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
