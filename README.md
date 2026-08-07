# Evolution

Evolution is an AI operator for Shopify founders. It combines a conversational 3D avatar with store audits, live product research, cart recovery, retention campaigns, fulfillment monitoring, and Shopify-grounded AI chat.

The public website and operator UI are built with React, TypeScript, and Vite. Production capabilities are served through Vercel API routes and use Supabase for authentication and persistence. Shopify provides read-only store data, Groq powers hosted AI and voice features, and Polar provides web subscription billing.

## Product surfaces

- **Free store audit** — scans a public store and, when Shopify is connected, adds real store metrics.
- **Product Hunt** — reads the current catalog, researches three adjacent product opportunities from live market sources, supplies sourcing leads, and drafts ready-to-paste listings. Signed-in accounts receive five hunts per day; configured admins bypass that cap.
- **AI operator chat** — answers with connected catalog, audit, order, customer, and checkout context.
- **Operator skills** — runs structured ecommerce research and operating workflows.
- **Cart recovery** — identifies abandoned checkouts and drafts recovery messages for approval.
- **Customer retention** — segments customers and drafts win-back outreach.
- **Operations** — summarizes fulfillment activity and receives live Shopify events.
- **Voice avatar** — supports typed or spoken conversations, server or browser speech synthesis, lip-sync, and a procedural fallback avatar.

Evolution is read-only against Shopify. It drafts and recommends actions but does not silently modify a merchant's store.

## Architecture

```text
Browser
  React UI + 3D avatar + optional local STT/TTS
      |
      | /api/*
      v
Vercel Edge functions
  auth, audits, chat, product research, billing, webhooks
      |                 |                 |
      v                 v                 v
  Supabase           Shopify           Groq / Polar / Resend
```

Important directories:

```text
src/                 React application and browser-side clients
src/hooks/           chat, STT, TTS, and avatar orchestration
src/avatar/          Three.js avatar implementations and lip-sync
src/components/      free and Operator product interfaces
api/                 Vercel endpoints and shared server engines
supabase/            database migrations and RLS policies
content/blog/        source articles for the generated marketing blog
tools/               blog generation, billing setup, and asset utilities
public/              static pages, catalog fixture, and avatar model
```

The local Vite server mounts the handlers in `dev-api.ts`, so `/api/*` behavior is available during development without running a second server.

## Local development

Requirements:

- Node.js 18 or newer
- npm
- Chrome or Edge for the fullest microphone, Web Speech, and WebGPU support

Install and start:

```bash
npm install
copy .env.example .env
npm run dev
```

On macOS or Linux, use `cp .env.example .env` instead of `copy`.

Open `http://localhost:5173` for the marketing site or `http://localhost:5173/app` for the application.

Useful commands:

```bash
npm run dev        # build blog pages and start Vite with local API routes
npm run typecheck  # validate TypeScript
npm run build      # generate the blog and create the production bundle
npm run preview    # serve the production bundle locally
npm run blog       # regenerate blog pages and sitemap only
```

## Configuration modes

The full product uses server-side infrastructure, but selected pieces degrade gracefully:

- Without Supabase client variables, the original chat/avatar demo can run without a login gate.
- Without client LLM variables, browser chat falls back to its catalog-backed mock brain.
- Without Shopify credentials, store connection is unavailable.
- Without Polar credentials, web billing falls back to the contact path.
- Product Hunt requires Supabase authentication, the service-role key, and `GROQ_API_KEY`.
- Paid Operator APIs enforce `profiles.plan = 'operator'` on the server when Supabase is configured.

Do not interpret the open demo mode as a production configuration. A real deployment should configure Supabase, Groq, and the required integration secrets.

## Environment variables

Use [.env.example](./.env.example) as the canonical variable list. The main groups are:

- `VITE_SUPABASE_*` — browser authentication and RLS-protected reads
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — trusted server persistence and user resolution
- `GROQ_API_KEY`, `GROQ_CHAT_MODEL`, `GROQ_RESEARCH_MODEL`, `GROQ_TTS_MODEL` — server AI, research, and TTS
- `VITE_LLM_*` — optional browser-side OpenAI-compatible chat mode
- `SHOPIFY_*`, `VITE_SHOPIFY_*` — OAuth, embedded app, webhooks, and App Store routing
- `POLAR_*` — hosted checkout, customer portal, and billing webhooks
- `RESEND_*`, `TEAM_NOTIFY_EMAILS` — optional team notifications
- `ADMIN_EMAILS`, `VITE_ADMIN_EMAILS` — server feature-cap bypass and client admin navigation

Only variables prefixed with `VITE_` are safe to expose to the browser. Never prefix service-role, Shopify secret, Groq, Polar, or Resend credentials with `VITE_`.

## Database setup

Create a Supabase project and apply the SQL files in `supabase/` in filename/date order. The Product Hunt feature specifically requires:

```text
supabase/2026-07-27_rate_limits.sql
supabase/2026-07-29_product_hunt.sql
```

The migrations enable RLS. Browser clients read only their own records; server inserts use the service-role key.

## Deployment

Production is designed for Vercel because the repository includes Edge API routes, clean URLs, and middleware for Shopify iframe security. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete Supabase, Vercel, Shopify, Groq, Polar, webhook, and verification checklist.

A static-only host can serve the marketing and browser demo assets, but it cannot provide the authenticated audit, Product Hunt, Operator, billing, or Shopify webhook features.

## Product catalog and avatar

- `public/products.json` is the fallback/demo catalog used by the mock assistant.
- `public/models/sherry.glb` is the bundled avatar.
- `src/avatar/constants.ts` controls the default model URL.

Kokoro and Transformers-based speech features may download large model assets on first use and cache them in the browser. The production bundle also contains a sizeable ONNX runtime asset.

## Security model

- Shopify OAuth state and callback HMAC are verified server-side.
- Shopify and Polar webhooks require valid signatures.
- Paid routes verify the Supabase bearer token and plan server-side.
- Sensitive Supabase operations use the service-role key only in API routes.
- Public audit crawling rejects local, private, and otherwise unsafe targets.
- Expensive endpoints use request limits backed by Supabase.
- Shopify access scopes are read-only by default.

## License

The project is licensed under the [MIT License](./LICENSE). Third-party models, services, avatar assets, and Shopify integrations retain their own licenses and terms.
