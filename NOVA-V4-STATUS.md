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


## Short signup and real backend bridge — November 8

Published the shorter shared signup UI and server-side website bridge in deployment dpl_GakbCTpKWwvXGBtbAFonBghfowwX, READY at https://nova-evolution-v4.vercel.app. The scripted walkthrough moved to /demo.html. Actual signup posts to /signup/checkout, and the website forwards supported public routes to NOVA_BACKEND_URL when a persistent backend exists. Signed webhook bodies/signatures are forwarded unchanged; private admin routes are excluded.

Added public availability and a worker heartbeat. Payment creation stays closed until core configuration, a recent worker heartbeat and an explicit launch flag are present. Updated the Docker image to include the shared signup renderer. 110 backend tests and six website bridge tests pass; signup DOM checks verify availability gating and untrusted payment URL rejection.

The Vercel project has no environment variables or persistent backend host. Stripe installation was attempted and returned integration_terms_acceptance_required. The user was given the Vercel Stripe terms URL in an asynchronous question. No terms were accepted by the agent, payment resource provisioned, payment taken, or provider delivery claimed. Meta, AI and optional voice/Calendar credentials remain absent. This is not yet a working paid operator.


## Stripe provisioning and actual provider test — November 8

After the user accepted Vercel's Stripe integration terms, provisioned sandbox resource stripe-coffee-island, ir_4E1GNUfntgpWea8q, attached to nova-evolution-v4. The user still must complete Stripe's separate claim/activation flow. Current resource claim_status is sandbox.

Created/reused Nova product nova_evolution_v4 and a USD 200 monthly sandbox price. The real Stripe API created a subscription Checkout session successfully; no payment was submitted. Expired the smoke-test sessions. Saved non-secret results in nova/billing-sandbox.json. Secrets remain in ignored local environment files and the provider-managed Vercel integration.

Actual Stripe testing exposed valid checkout URLs with Stripe fragments being rejected. Fixed validation to preserve fragments while retaining exact HTTPS Stripe-host validation. Added a regression and blocked sandbox keys from opening production checkout. 112 backend tests and six bridge tests pass.

The Stripe claim page was sent to the user. Computer-use opening timed out; no browser activation is claimed. Live Stripe account ownership/activation, live price, live webhook signing secret, persistent server/worker, Meta credentials and AI configuration remain outstanding. Production checkout remains closed.

## Pakistan individual onboarding correction — November 8

The user clarified they reside in Pakistan and have no registered entity. Researched official provider rules before proceeding. Stripe's sandbox setup is not a route to a live Pakistan merchant account. Chose to attempt Paddle because its published country policy does not exclude Pakistan and its verification guidance explicitly accommodates individuals/sole traders. Approval is not guaranteed.

Opened Paddle signup in Chrome, selected Digital products or SaaS, and accepted the policy checkbox after explicit user confirmation. Filled Subhan Ahmed and the existing Gmail; marketing opt-in was left unchecked. Password creation is a user handoff and is pending. Do not submit invented registration, address, identity, banking or tax information. Do not use the US outreach footer as the applicant's actual address.

Prepared truthful, reviewable applicant/product answers in nova/PAYMENT-ONBOARDING-PK.md. No Paddle account, provider approval, live integration or payment is claimed. The persistent backend, Meta/AI setup and actual fulfillment test remain outstanding.

## MVP-first free pilot checkpoint — November 8

User parked checkout and prioritized all other MVP requirements, free resources until the first customer, and early Git pushes. Core implementation checkpoint de1fd22 was pushed before further work. Audit: 18 non-payment capabilities, 12 implemented and locally testable, four partial, two missing. Read nova/MVP-IMPLEMENTATION-AUDIT.md for exact definitions; these counts do not imply 12 capabilities verified live over WhatsApp.

Added expiring bounded pilot invitations independent of payment, explicit Groq/loopback Ollama profiles without a paid fallback, constrained local model output, secret-free diagnostics and an interactive fictional local review. Found installed Ollama/llama3.2:3b on this Mac; started it on loopback and completed a real-model acceptance run through detailed interview, trial, workflow activation, customer proposal, approved lead save, rejected send, pause/resume and report. Recorded 3,408 model tokens. No external messages or paid API calls. Found and fixed detailed interview state being lost on a free pilot's initial greeting.

124 Python tests and six bridge tests pass. Current model inference can run locally without an API fee, but this requires the Mac awake; the backend has no durable unattended cloud deployment. Real WhatsApp, voice/Calendar setup and arbitrary product-building remain outstanding. Prepared free cloud directions without claiming they were provisioned. Paddle is open at the account onboarding screen; no further payment changes were made after the priority switch. Remaining Codex account credits are not accessible; do not claim to monitor them.
