# Nova v4 implementation audit

November 8, 2026, Asia/Karachi. Payments are deliberately excluded from the priority count below.

## Count

18 non-payment capabilities reviewed: **12 implemented and locally testable, four partial, two missing**. “Implemented” means functioning code exists and has been exercised locally; it does not mean that a live WhatsApp customer deployment has been verified. The public web signup is online. The persistent operator backend is not deployed in the cloud.

| # | Capability | Status | Evidence / remaining boundary |
|---|---|---|---|
| 1 | Simple number/consent signup | Implemented; public UI live | Short shared renderer, real routes, availability gate. No operational pilot provisioned through public signup yet. |
| 2 | Detailed business interview | Implemented locally | Business, goal, tools, bottlenecks, volume/time baseline, knowledge, permissions, trial and activation. Real local-model acceptance passed. |
| 3 | Import selected business knowledge | Implemented locally | UTF-8 text/CSV/JSON imports and validated WhatsApp document adapter. Private by default; explicit SHARE required for customer use. It does not automatically access all historical WhatsApp chats. |
| 4 | Owner approvals and permissions | Implemented locally | Allow/approve/deny controls, individual action approval/rejection, pause/resume. Model cannot change permissions through scheduled work. |
| 5 | Suggest first automation | Implemented locally | Three scoped recipes with requirements and baseline estimates. Suggestions depend on current supported tools. |
| 6 | Build/review/activate supported workflow | Implemented locally | Inquiries, follow-ups and quote preparation. Sample review plus explicit activation. Actual local-model run passed. |
| 7 | Handle customer inquiries | Implemented locally | Customer-scoped references, bounded model output, lead/reply proposals. No actual customer-channel delivery verified. |
| 8 | Scheduled follow-up | Implemented locally | One follow-up after four hours; stops for reply, opt-out or booking. Execution persists and follows owner rules. |
| 9 | Leads, quotes and local bookings | Implemented locally | Tenant-scoped records with validation and approval. Local booking is not a supplier reservation, payment or confirmed revenue. |
| 10 | Weekly report | Implemented locally | Once per UTC week, recorded work states, available usage and optimization suggestion. Live template delivery pending. |
| 11 | Durable local tasks and private business state | Implemented locally | SQLite, atomic claims, duplicates suppressed, uncertain deliveries require reconciliation, one worker, business isolation. Cloud durability not established. |
| 12 | Free pilot access and local AI reasoning | Implemented; real model tested | Admin-created 1–30 day pilot, default 100,000 conservative token allowance, no payment required. Existing local llama3.2:3b answered and completed acceptance run. |
| 13 | Automatic WhatsApp welcome and ongoing owner/customer messaging | Partial | Official signed adapters and routing implemented. Meta account/test number, approved templates and connected business channels remain unavailable. No live WhatsApp acceptance test. |
| 14 | Voice notes and detailed calls | Partial | On-device Whisper transcription is installed and a real spoken instruction was transcribed successfully. Local voice uploads and the WhatsApp media adapter use it. Twilio call hooks exist but no live calling provider is connected; native WhatsApp calls remain absent. |
| 15 | Business tool connections | Partial | Google Calendar OAuth and event adapter plus explicit custom connector endpoints. No live Google authorization or travel supplier integration. Other apps are not automatically available. |
| 16 | Time/cost optimization | Partial | Owner baseline, estimated savings, model usage records, approval/failure recommendations. No measured savings or complete provider-cost reconciliation. |
| 17 | Build arbitrary products/software from conversation | Missing | Current builder assembles reviewed recipes; it does not create, deploy and maintain arbitrary applications. |
| 18 | Unattended free cloud server with persistent storage and reasoning | Missing | Current persistent backend is local. Free hosting and inference have limits; no approved cloud account/resources configured. Mac-off operation is not available. |

## Actual reasoning verification

Ran `python3 nova/tools/verify_local_pilot.py` against the already installed local Ollama `llama3.2:3b` model, using fictional business data and a temporary database. Passed detailed interview, sample review/activation, recipe build, customer reply proposal, approved lead save, rejected send, pause/resume and report. Recorded 3,408 model tokens for that run. Zero external customer messages and zero paid API requests.

The first unconstrained model attempt proposed malformed actions. Added constrained JSON output with explicit tool names and argument shapes for local inference; execution validation remains in force. The successful run is not a claim that this small model is reliable enough for autonomous customer-facing operation. Keep approvals enabled in the pilot.

Current automated checks: **124 Python backend tests and six website bridge tests pass**. Python compilation and diff checks pass.

## Current backend in plain language

An owner/customer message enters through a signed provider callback. SQLite saves it as a task. One worker retrieves relevant business documents and recent context, asks the selected model to propose a reply/actions, and saves those proposals. Owner rules determine which actions may execute. Each result is saved; owner updates and the weekly report are queued for WhatsApp delivery. Secrets stay outside the model's business documents.

Reasoning is inference over retrieved business data, not training or fine-tuning the model. The model has only the implemented tools. It cannot silently gain access to a business's WhatsApp history, software or supplier accounts.

## Free pilot route now

- Existing Mac: local server/worker, persistent SQLite and installed Ollama text model. No inference API fee; computer resources/electricity still apply. The Mac must remain on. The local review command never sends external messages.
- Hosted inference option prepared: `NOVA_AI_PROVIDER=groq`, own Groq key and chosen available model. Groq exposes a free plan with model-specific rate limits; no key is configured, no paid fallback is enabled, and no guarantee of free capacity is made.
- Cloud option to evaluate before migration: Cloudflare Workers + durable storage + Workers AI on a free-compatible model. This needs a runtime/storage port and an authorized Cloudflare account, not uploading the existing SQLite background worker unchanged.
- Render free services sleep after inactivity and cannot attach persistent disks. Deploying this SQLite worker there unchanged would risk losing state, so it has not been done.

Provider references checked November 8:
https://docs.ollama.com/api/openai-compatibility
https://console.groq.com/docs/openai
https://console.groq.com/docs/rate-limits
https://developers.cloudflare.com/workers-ai/platform/pricing/
https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/
https://render.com/docs/free

## Before the first real customer

Connect the actual business messaging channel and verify owner and customer routing; complete a real reply/approval/delivery/opt-out test. Select a persistent host, backup plan and model capacity appropriate to that customer. Only then activate billing for a provider-approved account. Payments and Paddle onboarding are parked while this MVP work is the user's priority.
