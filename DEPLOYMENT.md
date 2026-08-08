# Production deployment

Evolution's complete production stack is Vercel + Supabase + Shopify + Groq, with Polar and Resend optional. This guide assumes the canonical domain is configured before external callbacks and webhooks are registered.

## 1. Prepare Supabase

1. Create a Supabase project.
2. Apply every SQL file in `supabase/` in filename/date order.
3. In Authentication URL Configuration, set the production Site URL to `https://<your-domain>/app`.
4. Add any required redirect URLs for local and production sign-in.
5. Copy the project URL, publishable/anon key, and service-role key.

The service-role key bypasses RLS and must exist only in Vercel/server environment variables. Never expose it through a `VITE_` variable.

Product Hunt requires both `2026-07-27_rate_limits.sql` and `2026-07-29_product_hunt.sql`. Shopify, billing, recovery, retention, compliance, and operations depend on their corresponding migrations.

## 2. Configure Groq

Create a Groq API key and configure:

```dotenv
GROQ_API_KEY=
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
GROQ_RESEARCH_MODEL=groq/compound-mini
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
```

The chat model powers hosted conversation and JSON formatting. The research model must support live search for Product Hunt and research skills. The TTS model is optional if only browser speech is required.

## 3. Create the Vercel project

1. Import this repository into Vercel.
2. Use the Vite framework preset.
3. Use `npm run build` as the build command and `dist` as the output directory.
4. Attach the production domain.
5. Add the environment variables below to Production and the appropriate Preview environments.

Core variables:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

GROQ_API_KEY=
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
GROQ_RESEARCH_MODEL=groq/compound-mini
GROQ_TTS_MODEL=canopylabs/orpheus-v1-english

ADMIN_EMAILS=founder@example.com
VITE_ADMIN_EMAILS=founder@example.com
```

Keep `ADMIN_EMAILS` and `VITE_ADMIN_EMAILS` aligned. The server value controls trusted feature-limit bypasses; the browser value controls admin navigation visibility. Database admin policies must also contain the intended admin identities.

Deploy once before registering callbacks so all `/api/*` URLs exist.

## 4. Configure Shopify

Create or link the Shopify Partner app and configure:

```dotenv
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SCOPES=write_products,write_files,write_discounts,read_orders,read_checkouts,read_customers
VITE_SHOPIFY_API_KEY=
VITE_SHOPIFY_APP_HANDLE=runevolution
```

The browser API key is the public Shopify client ID. The API secret must remain server-only.

Set the application URL to:

```text
https://<your-domain>/app
```

Set the OAuth redirect URL to:

```text
https://<your-domain>/api/shopify-callback
```

The repository's `shopify.app.toml` defines the constrained v1.1 write scopes, embedded behavior, ordinary webhook subscriptions, and privacy-compliance endpoints. Review its domain and handle, then push it with the Shopify CLI:

```bash
shopify app config link
shopify app deploy
```

Required webhook endpoints:

```text
POST https://<your-domain>/api/shopify-webhook
POST https://<your-domain>/api/shopify-compliance
```

Write scopes power v1.1's merchant-approved action cards. Existing stores must reconnect after scope changes; never execute a Shopify mutation outside the persisted proposal and approval flow.

## 5. Configure web billing with Polar

Polar is the billing rail for accounts that do not subscribe through Shopify. Create an organization access token, then use the included idempotent setup utility:

```bash
POLAR_ACCESS_TOKEN=<token> node tools/polar-setup.mjs
```

Add its returned values to Vercel:

```dotenv
POLAR_ACCESS_TOKEN=
POLAR_PRODUCT_ID=
POLAR_WEBHOOK_SECRET=
# POLAR_API_BASE=https://sandbox-api.polar.sh
```

The production webhook is:

```text
POST https://<your-domain>/api/polar-webhook
```

Leave `POLAR_API_BASE` unset for production Polar. Use the sandbox base only with sandbox credentials and products.

## 6. Configure optional notifications

To email the team when users file tasks, verify a sender domain in Resend and add:

```dotenv
RESEND_API_KEY=
RESEND_FROM=Evolution <notifications@your-domain>
TEAM_NOTIFY_EMAILS=operator@example.com
```

Tasks still persist without Resend; only email notification is skipped.

## 7. Production verification

Run locally before deployment:

```bash
npm run typecheck
npm run build
```

After deployment, verify:

1. `/`, `/pricing`, `/privacy`, and `/app` load through clean URLs.
2. Magic-link login returns to `/app` and creates/loads the user profile.
3. A free account can connect a store, run an audit, and run Product Hunt.
4. Product Hunt streams status messages, returns three product cards, and reloads the saved report for the same store.
5. A free account receives a server-side upgrade response from paid APIs.
6. Polar checkout returns to the app and its signed webhook upgrades the profile.
7. Shopify OAuth or embedded installation completes and the connected catalog loads.
8. Shopify webhook deliveries create live store events and duplicate delivery IDs are ignored.
9. `/app` can be framed by the intended Shopify admin and not by arbitrary sites.
10. Disconnect/uninstall and privacy-compliance flows remove or anonymize the intended data.

## 8. Operational notes

- Vercel logs contain structured warnings for upstream AI, persistence, billing, and webhook failures.
- Supabase contains the durable audit, hunt, profile, store, task, recovery, retention, event, and rate-limit state.
- Product Hunt performs live research and can take roughly a minute. Its SSE progress stream keeps the request visibly active.
- The frontend bundle is large because of the 3D and local speech runtimes. This is expected, though route-level code splitting remains a future optimization.
- Re-run `npm run build` after editing blog content; the build regenerates blog pages and the sitemap automatically.
