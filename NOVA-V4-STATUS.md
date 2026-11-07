# Evolution v4 — Nova by Evolution

Working branch `versions/v4-nova`. The first backend lives in `nova/`.

The owner manages Nova through WhatsApp text, voice notes and an inbound phone-call adapter. Nova uses supplied business references, persistent tasks, owner tool rules and configured integrations. The planned subscription is $200/month with a measured usage allowance.

Read `nova/MVP.md` for features and pilot acceptance criteria. Read `nova/README.md` for local setup and provider configuration.

Verified on November 8, 2026 Asia/Karachi — 20 local tests pass, including model planning through a simulated provider, approval and execution, signed webhooks, recipient restrictions, data isolation, duplicate handling, scheduled tasks and uncertain delivery. Python compilation and a real local HTTP startup/message/report/readback smoke test also pass.

Live WhatsApp and calling tests are pending. No Meta, Twilio or AI provider credentials were available in this checkout. The user selected Meta's test number. The user signed into Facebook successfully. Meta’s documentation still offered Get Started for developer registration. Its registration dialog rendered blank or redirected to the public developer homepage after reload. No app dashboard, test number or credentials were obtained. The Chrome Meta setup tab was preserved for handoff.

This is a backend implementation. It has no production cloud deployment, subscription collection or verified live provider delivery. The AI connection must be configured to perform real reasoning. The third-party US texting provider has not been identified. The Twilio adapter currently supports inbound owner calls with turn-based speech.

No replacement of the existing live v3 site was performed. Deploy the v4 worker and server on a persistent host when accounts are connected. Vercel's static v3 build does not run this Python worker.


## November 8 continuation

Added guided WhatsApp onboarding, private owner document imports, explicit sharing controls, sample reply review and activation. Added pause/resume, pending-action approval, signed SMS ingestion/replies for optional Twilio numbers, lead/quote/local-booking records, and Google Calendar OAuth/event creation with encrypted tokens. Provider credentials and actual user documents remain unconfigured.

73 local tests pass, with simulated external providers. Python compilation and diff checks pass. Google OAuth helper code was reviewed and integrated after its implementation subagent reached its usage limit. No real provider authorization or delivery was performed. The public site remains v3; v4 backend deployment still needs a persistent server, worker and configured provider accounts.
