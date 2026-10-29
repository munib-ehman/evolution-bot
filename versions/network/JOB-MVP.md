# Evolution job marketplace

The network version now serves a public recurring automation job board. Two primary views: homepage/job board and reusable form (developer registration, verified business posting, application, passwordless login). The owner-only admin view is available after authentication at `/?action=admin` or `/owner-analytics`. No developer dashboard, listings, payments, execution, chat, bidding or recommendations.

## Data and access

Apply `supabase/2026-10-29_job_marketplace.sql` and then `supabase/2026-10-29_legacy_job_outcome.sql`. Existing data is retained. The original request remains in `network_posts`; its copied job uses the same ID and original date. The concise outcome and daily frequency come from the request itself. No monthly price was supplied, so that field is explicitly unknown rather than reinterpreting a historical task budget.

Three main tables: `evolution_users`, `evolution_jobs`, `evolution_applications`. Private `evolution_mail_queue` is delivery bookkeeping, not another product feature. Public readers see jobs only. Account emails and proposals are private under RLS. Registration derives verified email and identity from Supabase Auth, never client IDs or admin claims. The existing verified owner's email is checked server-side for admin. All writes use bounded transactional functions. Applications have a database unique constraint on `(job_id, developer_id)`.

## Emails

Supabase sends passwordless authentication email using the existing custom SMTP configuration. The client saves the business draft in session storage while email is verified; drafts are not published automatically by visiting a magic link. Open the original browser tab to retain a draft; on another device enter the job details again.

Posting atomically enqueues one email per opted-in verified developer. Applying atomically saves the proposal and enqueues a business email containing the developer name, verified email and proposal, with Reply-To set to the developer. Businesses reply through their own email provider. Email failures do not lose jobs or applications.

`/api/job-notifications` uses the existing server-only Supabase service key, `RESEND_API_KEY`, `RESEND_SHARED_FROM_ADDRESS` and `CRON_SECRET`. An authenticated publisher/applicant can wake processing for their own events; the existing five-minute GitHub workflow processes the remaining queue without needing a Mac. GitHub scheduling can be delayed. Database locks plus stable Resend idempotency keys prevent concurrent duplicate sends. Accepted provider IDs are recorded; unknown outcomes become `uncertain` and are not blindly retried. Failed/uncertain deliveries require owner inspection, not an inbox-delivery claim. No fallback to the stopped outreach worker or personal Gmail credentials.

New-job emails include an authenticated alert-preference link using the same reusable form. This is transactional product registration, not permission to import or email scraped developer leads. Provider quotas and actual delivery need verification before calling the MVP complete; do not buy plans or assume unlimited sending.

## Validation

`npm run build`, `node tools/test-network-guides.mjs`, `node tools/test-job-notifications.mjs`, and `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node tools/test-job-marketplace.mjs`.

Keep legacy `/blog` and `/guides` URLs and article dates intact. Client code contains only the existing public Supabase key. No new paid services or credentials.
