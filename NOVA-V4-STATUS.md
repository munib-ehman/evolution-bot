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

## Managed Mac host — November 8

Installed a per-user login service io.runevolution.nova. The first launch from Documents was blocked by macOS background privacy controls; corrected the installer to copy reviewed runtime code into ~/Library/Application Support/EvolutionNova. Server, worker, callback gateway, keep-awake helper and Cloudflare Quick Tunnel were observed running. SQLite initialization is now performed before concurrent children start after observing a startup database-lock race. Existing Ollama local model is reused, with restart takeover if it disappears. Credentials and database are excluded from Git.

Connected the existing live Vercel website to the Mac's allowlisted gateway with NOVA_BACKEND_URL; deployment dpl_AgtRBqxkhTEg4EDPyVTpEEcTisDb READY. Local health reported AI configured; worker heartbeat was present; the local callback verification challenge succeeded. Private admin/model/health routes returned 404 through the public tunnel. Free Quick Tunnel addresses rotate after reconnection; website synchronization is currently an explicit link-website command, not a stable named tunnel.

127 Python tests and six bridge tests pass. Browser inventory reported “Local browser use is disabled in Work settings.” The user asked the agent to enable it, but that access control cannot be changed through the blocked browser/app surface. Provided the official Settings > Computer Use path. Meta setup remains pending; no WhatsApp credentials, real phone, actual provider delivery or functioning WhatsApp chat is claimed. User-account credit balance is not accessible. Preserve Paddle signup; payments are not the current priority.

Managed host acceptance after deployment: authenticated loopback /local/message queued a clearly marked INTERNAL TEST instruction, the actual background worker used the installed local model, and the SQLite event completed with a correct Nova answer and zero proposed actions. Public website /public/status returned 200, unsigned /webhooks/whatsapp returned 403, /local/state returned 404, and the correct verification challenge through the public website -> Vercel bridge -> tunnel -> Mac returned HTTP 200 with the expected challenge. This verifies callback routing but does not establish Meta subscription or WhatsApp messaging.

## WhatsApp registration checkpoint — November 8

Browser access became available after the user's settings/restart work. Meta /apps redirected to the developer homepage because registration was incomplete. Reloading the visible registration dialog produced the actual verification flow. The account's SMS verification is observed complete. Contact-email confirmation remains incomplete; Meta rejected the previously displayed email code and a fresh email was requested. The user was asked to complete that email step directly. No OTPs, account-verification phone or secrets are saved here.

The user explicitly requested the first Nova message to their Pakistan mobile number and ongoing chat there. Saved the normalized recipient privately in the installed runtime's data/whatsapp-setup.json, with message_sent=false. No message has been sent, app/test number obtained, credentials configured or real WhatsApp chat verified. Mac services remain running and prior public callback tests passed.

## November 10 resume

Mac login service, worker, local model, callback gateway and tunnel are running. Free tunnel rotated after restart; reconnected the existing Vercel website to the current Mac endpoint using mac_host.py link-website. Deployment dpl_DKexbkiNbP4R8bbZtYsKapfm7vV4 is READY.

Meta app setup could not resume because Facebook redirected /apps to a human-verification checkpoint. Opened the checkpoint and observed the image-text CAPTCHA. Left completion to the user, with an asynchronous request. No challenge was solved or bypassed. No Meta app creation, test number, token or first WhatsApp message has been confirmed. Existing code remains pushed on versions/v4-nova; private runtime recipient remains as authorized by the user.

The reconnected public website verification challenge returned HTTP 200 with the exact expected response. Meta's checkpoint subsequently advanced to a “Video selfie complete” identity-verification dialog with an Upload button. The user was asked to review and submit biometric verification directly to Facebook; the agent did not record, retrieve, upload or submit the selfie. WhatsApp remains unconnected pending Meta's account outcome.

## Meta appeal outcome observed — November 10

After the user completed the checkpoint and selfie submission, Facebook displayed “Subhan, you submitted an appeal” dated 10 November 2026. The page says the profile is unavailable pending review and to check back for the result; its stated usual review time is about an hour, not a guarantee. This is a provider account restriction, so app creation and WhatsApp setup cannot proceed until access is restored. No new accounts, alternate identities or access workarounds were attempted. No WhatsApp message has been sent. The appeal tab was preserved for the user.

## November 10: real SEO + inbound-sales demo; automatic execution

- Added persisted SEO / BDR / business-learning workproducts using the configured model and business references. Owner commands: `SEO ...`, `BDR ...`, `LEARN ...`. SEO drafts exclude private conversation imports; sources and usage are saved. Producing a document does not publish it.
- Added automatic execution mode for new pilots and an authenticated owner command `WORK AUTOMATICALLY`. Supported actions use automatic execution in this mode; explicit existing rules and PAUSE still apply. Existing tenants are not silently migrated. Onboarding also offers automatic mode.
- Added a real loopback-only conversational demo at http://127.0.0.1:4192/ with isolated SQLite, business text imports, private historical conversations versus customer-safe facts, real local inference, simulated inbound leads, saved downloadable work, and no per-action approval UI. No external sends or publishing are available in that isolated demo.
- The demo runs as part of the Mac login service. No paid model fallback. It requires the Mac on and awake. It is a screen-share/local demo, not a public remote-user chat endpoint.
- First model acceptance exposed an invented hotel recommendation; simplified the customer-only prompt, removed owner tool descriptions from customer context and set deterministic generation. Retest requested exact dates and departure city without the unsupported recommendation. This is not a guarantee against model errors.
- Automated checks: 134 Python tests plus 6 bridge checks passed. Further live browser and model acceptance evidence follows below.
- Meta WhatsApp provisioning remains blocked by the account appeal. No real WhatsApp test message has been sent. Voice notes/calls need actual provider connections; the local demo explicitly labels these unavailable. Arbitrary business operations still require implemented integrations.

Live acceptance: actual Ollama inference generated a customer qualification reply, requested missing dates/departure city, excluded a private passport marker and obsolete historical price, and persisted an SEO article using only customer-approved facts. Browser flow imported the fictional travel example, answered a simulated inbound lead and generated an article, all without approval. Updated SEO output is constrained to include search intent, meta description, article and publishing checklist. The owner's existing pilot (if present) was set to automatic execution using the explicit November 10 instruction, without changing other tenants.

Final incremental QA: 138 backend tests + 6 bridge tests passed. New tests cover loopback host validation, cookie and cross-origin protections, private imports, tenant separation, schema validation, and real automatic execution of a supported local action. No owner-number tenant was found in the production database; no existing tenant was changed. New pilots default to automatic mode, and any authenticated owner can explicitly switch with WORK AUTOMATICALLY. The isolated demo already runs without approval steps.

Operational note: restarting the login host invalidated the prior free Cloudflare tunnel. Re-provisioning has not yet returned a new tunnel URL, so the public bridge is not currently verified. The loopback demo and local inference are working independently. Do not describe the real WhatsApp channel or public callback bridge as live until verified.
