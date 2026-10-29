# October 29 MVP revamp

In progress. User explicitly authorizes replacement of the network UI with a two-screen recurring automation job marketplace and production deployment. Marketplace developer leads are second priority, only after the MVP is verified.

- Existing Supabase project: kclrehokakofftxijxuf. Dashboard login restored using existing GitHub authorization.
- Existing Vercel CLI account has no access to the production project; GitHub origin/main deployment remains the authorized release path.
- New additive migration: supabase/2026-10-29_job_marketplace.sql. Three main tables and one private operational mail queue. Applied successfully through the authenticated SQL editor; public RLS read verified the single migrated request and original date.
- Legacy request original text/date preserved in network_posts. Actual text explicitly requests a daily shortlist, so the follow-up migration 2026-10-29_legacy_job_outcome.sql condenses that outcome and sets Daily. Its old one-off budget is not evidence of a monthly budget: keep monthly budget null and label explicitly.
- Existing legacy SEO /blog and /guides URLs must remain. No outreach sends or lead discovery until MVP verified.
- Automatic hourly continuation: evolution-mvp-then-marketplace-leads. Never overlap database/git mutations. Delete after both priorities complete.
- Owner outreach is stopped: config.enabled=false, LaunchAgent unloaded and disabled. Do not restart.

Implemented src/jobs frontend, transactional API and notification retry hook in existing workflow. Local build and PGlite tests passed (verified registration, private data RLS, role isolation, duplicate applications, closed jobs and atomic notification queue). Local preview at 4185. Supabase custom SMTP is already enabled via smtp.resend.com. Production Vercel notification sender configuration still needs verification. Never claim production/email success until verified.
