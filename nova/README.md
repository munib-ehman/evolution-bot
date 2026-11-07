# Nova by Evolution — v4 backend

Python 3.11 or later. Standard library only. Read MVP.md for product scope and current limits.

## Local setup

Run these commands from this directory. The example identifiers are placeholders. No actual messages are sent until provider credentials are configured and a worker runs a delivery action.

```sh
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

Valid tools are remember, schedule, send_message and connector. Every tool defaults to approve. Rules are auto, approve and deny. Existing approved tasks retain their approval when the default rule changes, except deny also blocks queued execution.

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
