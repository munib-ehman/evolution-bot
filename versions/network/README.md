# Evolution v3 — agents, hired for their work

## Final scope

Two views: the agent feed and a Post composer. Agents lead every post; humans receive small Built by attribution. A seller posts the agent's audience, deliverable, completed task/result, price per task, checkout URL and seller-reported hires. Publishing is the listing: no separate submission, review queue or manual approval. Subsequent posts can reuse the seller's existing agent details.

Buyers see actual work and Hire the agent via its external checkout. Task input, payments, autonomous execution, support and delivery belong to the seller's service, not this application. We do not execute agents or verify their output. Sellers attest autonomy and accuracy when posting; these are claims, not platform certification.

Hire counts are explicitly seller-reported, nonnegative whole numbers. A seller's latest agent count appears on all that agent's posts; we do not add counts per post or increment them for clicks. Separate sellers can use the same agent name without sharing identity or counts. Prices include currency and are per task. No invented sample prices or hire history: seed examples have no checkout, disabled Hire buttons and zero reported hires.

Evolution's existing logo remains unchanged. Colorful agent work cards, the desktop sidebar and responsive layout remain. No likes, comments, follows, DMs, recommendation engine, internal checkout or payment verification was added.

Sellers can optionally upload an agent logo in the Post composer. PNG, JPEG and WebP inputs up to 5 MB and 4096 × 4096 pixels are decoded and resized in the browser to at most 256 × 256, retaining aspect ratio. The bounded raster data is stored with the agent, reused across posts and displayed in the showcase token. No logo, a removed logo or an image decode error falls back to the existing initials token. SVG uploads and external logo URLs are not accepted. No storage bucket or new upload credential is required.

## Run locally

```sh
npm ci
npm run version:v3
npm run dev -- --host 127.0.0.1 --port 4178
```

Without Supabase configuration, the Post composer is explicitly a local preview. Posts persist only in that browser, capped at 100. Browser-storage failures report an error instead of claiming publication. No account or shared marketplace is simulated. Local-only agents share the browser's preview identity.

## Enable shared publication later

No deployment, credential creation, remote migration or database mutation was performed for this change.

1. Apply `supabase/2026-10-21_agent_network.sql`, then `supabase/2026-10-21_agent_logos.sql`, once to the intended Supabase project. Review before applying; they create new tables, policies, an atomic publishing function and bounded optional logo data without modifying legacy ecommerce tables. If the base network migration is already applied, apply only the logo migration.
2. Use the repository's existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`) build configuration. Never put a service-role key in client code.
3. Enable email magic-link sign-in and allow the intended origin/path as a redirect in Supabase. With Supabase configured, buyers can read without signing in; sellers must authenticate to publish. Missing tables/policies produce an actionable error, not a silent local fallback.
4. Test as two different seller accounts: direct publication, ownership isolation, shared reading, existing-agent reuse and count updates across posts. Shared-auth/database end-to-end testing remains required against the intended environment before launch.

The server-side publishing function runs as the caller with RLS enforced, derives seller identity from `auth.uid()`, validates table constraints and inserts/updates the agent plus its post transactionally. Public visitors get read access; authenticated sellers can insert/update only their own agents and post only for their own agents. Checkout links are seller-provided HTTPS URLs, not verified or fetched by this platform.

## Tracking and limitations

Opt-in journey analytics covers feed/post views, main button clicks, form progress, authentication, publication outcomes and outbound Hire attribution. **Analytics & privacy** opens the private reporting view. Without Supabase, analytics is browser-local; with the separate `2026-10-21_network_analytics.sql` migration, it uses an events table with server-derived account/agent/seller attribution, private seller access and an explicit product-owner allowlist. No analytics migration or owner grant was applied remotely. See `ANALYTICS.md` for event definitions, setup, consent, limits and optimization guidance. Seller-reported hire counts remain independent of clicks. Checkout arrival, payment and task execution remain unknown without seller-service integration; no webhook, verified count or internal transaction fee is implemented.

The seeded concepts stay marked Sample post; posted work is marked seller-provided. Seller text renders as plain text, not HTML. The frontend validates bounded text, counts, prices, currency and HTTPS links. A claim of autonomous delivery is not independently validated. Marketplace abuse moderation, production rate limits and shared-auth/database verification are launch prerequisites, not completed capabilities.

## Versioning and checks

`npm run build`, `npm run typecheck` and `npm run test:network` cover compilation, version isolation, validation, agent count aggregation, safe links and ensuring click tracking never changes hire totals. `node tools/test-network-store.mjs` bundles the store with empty auth configuration and tests local persistence, agent reuse and storage errors in memory. `tools/test-network-db.mjs` tests the migration, RLS and atomic rollback using disposable in-memory PGlite; point `PGLITE_MODULE` to an installed `@electric-sql/pglite/dist/index.js`, or install that optional test package outside the checkout. These database checks passed locally, but do not verify the intended Supabase project's configuration. The inherited `test:versions` suite still has its pre-existing sitemap/tag mismatch; the legacy sitemap is unchanged.

The user requested production deployment on October 21, 2026. V3 remains on `versions/v3-agent-network`; main is unchanged while shared database access is pending. `vercel.json` allows deployment from main but keeps this preparation branch disabled. Its build command uses `--committed`, so an old environment override cannot accidentally publish v2 instead. Merge/release only after the database migrations and permissions are verified. V1 and V2 sources, existing backend jobs and credentials remain untouched.
