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


## Paid onboarding and workflow assembly — November 8

Implemented server signup with phone/consent, Stripe-hosted USD 200/month checkout, signed payment/subscription webhooks, verified paid provisioning, one welcome per signup and shared Nova contact owner routing. Added hosted billing management links and execution gates for inactive or expired subscriptions. No live payment account or product was provisioned.

Added a detailed text/voice interview, approved outbound owner calls through Twilio, baseline collection, three explicit workflow recommendations, sample-tested recipe activation, one scheduled follow-up with cancellation checks, and weekly optimization suggestions. Model usage evidence is persisted and model costs can be estimated from configured rates; remaining provider charges remain unknown. Supported customer workflows remain inquiries, follow-ups and quote preparation through existing tools.

Live blockers remain Meta developer registration/test-number access, provider secrets and approved WhatsApp welcome/report templates, configured Stripe account/price/webhooks, and a persistent cloud deployment. The current detailer’s third-party number provider still needs identification. Calls are telephone calls through Twilio, not WhatsApp-native live calls. Custom code generation, supplier booking and arbitrary business automation are not implemented by the recipe builder.

Verification for this checkpoint — 99 local tests pass. Added a real HTTP signup/routing test with simulated payment creation, verified Stripe webhook-to-business-to-welcome flow, detailed onboarding, trial review, recipe activation, subscription expiry and checkout concurrency coverage. Python compilation and git diff checks pass. Vercel Marketplace discovery confirmed Stripe, but account resource listing returned no resources. No provider or paid resource was provisioned.


## Full audit and review preview — November 8

107 backend tests pass. Fixed scheduled text changing owner permissions, audio opt-out handling, approved quote workflow processing, duplicate checkout reuse after one hour, missing WhatsApp notices for scheduled work, and outbound call callback routing. Bound outgoing calls to approved action IDs and retain that binding through speech turns.

Added nova/preview as an explicitly scripted interactive product walkthrough, including setup, trial review, workflow activation, action approval, pause/resume, reports and guarded signup. DOM interaction checks pass. It collects no real data, takes no payments and sends no messages. This preview is not the live operator backend. Provider and persistent deployment blockers above remain unresolved.

Published a separate review demo at https://nova-evolution-v4.vercel.app (Vercel deployment dpl_HM1Fx71p68YNSH4jnpsmVoebzo77, READY). Existing runevolution.io remains unchanged. The demo is hosted independently from the persistent Nova backend. Vercel Git auto-linking to the repository was unavailable for this account, so the reviewed preview was uploaded directly.
