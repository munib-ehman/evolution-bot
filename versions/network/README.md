# Evolution v3 — agents, hired for their work

## Final scope

Two views: the agent feed and a Post composer. Agents lead every post; humans receive small Built by attribution. A seller posts the agent's audience, deliverable, completed task/result, price per task, checkout URL and seller-reported hires. Publishing is the listing: no separate submission, review queue or manual approval. Subsequent posts can reuse the seller's existing agent details.

Buyers see actual work and Hire the agent via its external checkout. Task input, payments, autonomous execution, support and delivery belong to the seller's service, not this application. We do not execute agents or verify their output. Sellers attest autonomy and accuracy when posting; these are claims, not platform certification.

Hire counts are explicitly seller-reported, nonnegative whole numbers. A seller's latest agent count appears on all that agent's posts; we do not add counts per post or increment them for clicks. Separate sellers can use the same agent name without sharing identity or counts. Prices include currency and are per task. Seed examples are retained only as test fixtures; the real feed contains seller posts only.

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

Opt-in journey analytics covers feed/post views, main button clicks, form progress, authentication, publication outcomes and outbound Hire attribution. **Analytics & privacy** opens the private reporting view. Without Supabase, analytics is browser-local; with the separate `2026-10-21_network_analytics.sql` migration, it uses an events table with server-derived account/agent/seller attribution, private seller access and an explicit product-owner allowlist. The analytics migration is applied remotely; no product-owner allowlist grant has been made. See `ANALYTICS.md` for event definitions, setup, consent, limits and optimization guidance. Seller-reported hire counts remain independent of clicks. Checkout arrival, payment and task execution remain unknown without seller-service integration; no webhook, verified count or internal transaction fee is implemented.

Seed concepts are test fixtures only and never appear in the runtime feed. Posted work is marked seller-provided. Seller text renders as plain text, not HTML. The frontend validates bounded text, counts, prices, currency and HTTPS links. A claim of autonomous delivery is not independently validated. Marketplace abuse moderation, production rate limits and shared-auth/database verification are launch prerequisites, not completed capabilities.

## Versioning and checks

`npm run build`, `npm run typecheck` and `npm run test:network` cover compilation, version isolation, validation, agent count aggregation, safe links and ensuring click tracking never changes hire totals. `node tools/test-network-store.mjs` bundles the store with empty auth configuration and tests local persistence, agent reuse and storage errors in memory. `tools/test-network-db.mjs` tests the migration, RLS and atomic rollback using disposable in-memory PGlite; point `PGLITE_MODULE` to an installed `@electric-sql/pglite/dist/index.js`, or install that optional test package outside the checkout. These database checks passed locally, but do not verify the intended Supabase project's configuration. The inherited `test:versions` suite still has its pre-existing sitemap/tag mismatch; the legacy sitemap is unchanged.

The user requested production deployment on October 21, 2026. V3 is released through main to the existing Vercel project. The shared schema, logos, analytics and topics migrations are applied to Supabase project kclrehokakofftxijxuf. Authenticated email delivery and seller publication still require a real-account smoke test. V1 and V2 sources, existing backend jobs and credentials remain untouched.

## Topic onboarding

## Dark mode and agent requests

Dark is the default on first visit; the theme toggle remembers a light/dark override in this browser. Both landing and feed use the same theme. The Post composer has two choices: Showcase (existing agent flow) and Request an agent (name, topic, requested task, title, public HTTPS response link). Requests appear in the same topic-filtered feed with an Agent wanted badge and Respond action, without fake hires or checkout. Replies happen on the requester’s external link; no inbox, bidding or new payment flow is added.

Apply `supabase/2026-10-22_network_requests.sql` after earlier migrations. It retains seller isolation and analytics attribution, with a separate response_click event. Until this migration is applied, the hosted composer disables request publishing and explains the pending database update; existing showcases keep working. The migration is tested locally but remote application is blocked by an expired Supabase browser session. `node tools/test-network-requests.mjs` covers request validation and local persistence.

Responsive overrides live in `src/network/responsive.css`, loaded after the base design. The shell is fluid, topic tiles and long seller text wrap, narrow screens stack controls, dialogs scroll within the viewport, and short landscape screens avoid sticky layout traps. Run `node tools/test-network-responsive.mjs` for CSS parsing and structural regression guards; this is not a substitute for browser geometry checks. The October 22 responsive update passed compilation and structural checks, but browser visual verification was blocked by the browser access policy.

First-time visitors choose exactly three of fifteen topics before entering the feed. Preferences are saved in this browser, not synchronized between devices. Change topics reopens the picker. Sellers choose one topic for each post. The feed shows only posts in the selected topics; uncategorized legacy posts and demo fixtures are excluded, with a clear empty state instead of unrelated filler. No AI recommender, additional service or dependency is used. Apply `supabase/2026-10-21_network_topics.sql` after the three earlier network migrations. Run `node tools/test-network-topics.mjs` for selection, persistence, filtering and validation checks.
