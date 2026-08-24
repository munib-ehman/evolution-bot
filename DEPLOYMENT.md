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
SHOPIFY_SCOPES=write_products,write_files,write_discounts,read_orders,read_checkouts,read_customers,write_customers
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

The repository's `shopify.app.toml` defines the constrained v1.1 write scopes, embedded behavior, ordinary webhook subscriptions, and privacy-compliance endpoints. It is already linked through its `client_id`. A TOML file cannot create the initial Dev Dashboard app by itself.

For a new app, authenticate Shopify CLI and create/link the app once:

```bash
shopify auth login
shopify app config link
```

Choose **Create a new app** when prompted. Shopify CLI writes the resulting `client_id` into the selected TOML configuration. After that, review the production domain and handle and deploy every configuration change with:

```bash
shopify app deploy
```

`shopify app deploy` synchronizes Shopify configuration and creates a new app version; it does not deploy the Vercel application itself.

Required webhook endpoints:

```text
POST https://<your-domain>/api/shopify-webhook
POST https://<your-domain>/api/shopify-compliance
```

Write scopes power v1.1's merchant-approved action cards. Existing stores must reconnect after scope changes; never execute a Shopify mutation outside the persisted proposal and approval flow.

### Generate the Vercel cron secret

`CRON_SECRET` does not come from Shopify. Generate your own random secret and save it as a server-only Vercel environment variable. For example:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the single output value to **Vercel → Project Settings → Environment Variables**, name it `CRON_SECRET`, select **Production**, and redeploy. Alternatively, run `vercel env add CRON_SECRET production`. Do not add the real value to `.env.example` or commit it.

The Vercel configuration intentionally contains no cron jobs so the project can deploy on the Hobby plan. All scheduled work runs from `.github/workflows/marketing-delivery.yml`: worker and delivery jobs every five minutes, store observation hourly, action metrics daily, and the product-manager job weekly. Add the **same value** as a GitHub Actions repository secret named `CRON_SECRET`; the workflow sends it to each secured endpoint as a bearer token. GitHub Actions schedules use UTC and may start a few minutes late during periods of high load.

## 5. Configure web billing with Polar

Polar is the billing rail for accounts that do not subscribe through Shopify. Apply `supabase/2026-08-19_role_entitlements.sql`, create an organization access token, then run the included idempotent setup utility:

```bash
POLAR_ACCESS_TOKEN=<token> node tools/polar-setup.mjs
```

Enable Polar's seat-based pricing beta under **Settings → General → Features** first. The utility creates one `Evolution Managers` product billed at $50 per selected manager and stores its Polar ID in `public.manager_plans`. Keep these secrets in Vercel:

```dotenv
POLAR_ACCESS_TOKEN=
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
