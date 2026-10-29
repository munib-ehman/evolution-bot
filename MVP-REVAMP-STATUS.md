# October 29 MVP revamp checkpoint

MVP implemented and released. User explicitly authorizes replacement of the network UI with a two-screen recurring automation job marketplace and production deployment. Marketplace developer leads are next priority.

- Existing Supabase project: kclrehokakofftxijxuf. Dashboard login restored using existing GitHub authorization.
- Existing Vercel CLI account has no access to the production project; GitHub origin/main deployment remains the authorized release path.
- New additive migration: supabase/2026-10-29_job_marketplace.sql. Three main tables and one private operational mail queue. Applied successfully through the authenticated SQL editor; public RLS read verified the single migrated request and original date.
- Legacy request original text/date preserved in network_posts. Actual text explicitly requests a daily shortlist, so the follow-up migration 2026-10-29_legacy_job_outcome.sql condenses that outcome and sets Daily. Its old one-off budget is not evidence of a monthly budget: keep monthly budget null and label explicitly.
- Existing legacy SEO /blog and /guides URLs must remain. No outreach sends or lead discovery until MVP verified.
- Automatic hourly continuation: evolution-mvp-then-marketplace-leads. Never overlap database/git mutations. Delete after both priorities complete.
- Owner outreach is stopped: config.enabled=false, LaunchAgent unloaded and disabled. Do not restart.

## Verified production release

- origin/main commits aa240b5 and 115856e, Vercel success on both. Public https://www.runevolution.io/ serves the new job board. Both / and /app use the new UI.
- Both migrations applied successfully via existing authorized Supabase SQL editor. Original legacy request remains untouched; copied public job retains original ID/date and now has concise outcome and Daily frequency. Monthly budget remains explicitly unknown, not invented.
- Public API: jobs 200 with exactly one migrated job; users/applications/mail queue all 401 anonymously. Unauthenticated notification API 401.
- Build, git diff --check, PGlite database tests and mocked notification handler tests pass. Existing 20 guides and 111 legacy archive URLs preserved; public guide 200, robots allow indexing.
- Board and application form checked at 320, 375, 768, 1024, 1440 and 1920 CSS pixels without horizontal document overflow. Developer join and business posting form fields inspected in the browser.
- Live owner-only admin displays one user, one job, zero applications. Owner must be email-verified and is checked server-side.
- Existing Supabase custom SMTP enabled through smtp.resend.com. Live owner-only test email was accepted by the existing Resend API configuration and independently visible in the owner's Gmail Inbox on October 29. No developer/business outreach, fake job or fake application was sent.
- Passwordless login verified end to end: live login form -> sign-in email delivered in Gmail -> actual magic link -> verified owner session restored on /?action=login.
- Full posting/application transaction and fan-out/duplicate protection verified in isolated PGlite, not with fabricated public production jobs. No real developer has registered or applied in production at the verification check. Do not claim actual application emails have been received by a real business yet.
- Existing GitHub five-minute schedule now invokes notification queue processing; GitHub may delay schedules. New-job publish/application calls also wake processing immediately. Do not claim instant delivery to unlimited recipients or provider quota immunity. Pending/failed/uncertain state remains in the private queue for inspection.
- Gmail connector requires reauthentication; verification used the user's already-authorized signed-in Gmail browser. No credentials extracted or created.
- Follow-up delivery hardening: Resend 429 requeues after a five-minute database cooldown; closed-job alerts are not claimed; ambiguous 5xx/timeouts are held uncertain rather than blindly retried; sends are paced and unattempted messages released before runtime exhaustion. Migration 2026-10-29_notification_backoff.sql applied through the SQL editor; rerun focused tests before release.

## Next: actual marketplace leads

Create a NEW tab on the user's existing refined Sheet 1MDBY2q9cEeUdK0tcmzU9VwzIpedxi6TyFUOzcTIWYWg. Do not replace the old bad GitHub list or misrepresent it as marketplace research. Target 1,000 unique developer publishers with actual competitor marketplace/directory agent listings, recent activity within the past year, and publicly available contacts. Front-facing columns: Name, Email, LinkedIn, X, GitHub, Platform, Agents built, Agent category. Store actual listing/profile URLs, date evidence, qualification, and deduplication privately. Do not infer paid status, personal identity or emails; no commit-email harvesting. Review first five genuine listing-backed leads before scaling efficient scripts. Reuse valid saved directory evidence but do not use GitHub discovery as a substitute. Never resume owner outreach. Notify factual counts only; 1,000 remains a target, not achieved.

New tab created: Marketplace publishers, gid 1872901029. Initial nine unique Apify publisher accounts and two public direct addresses verified by readback; platform/agent cells link to real profiles/listings. Names include teams/brands and must not be called nine verified individual developers or nine emails. No social URLs or emails guessed. Private scripts/evidence in ../evolution-marketplace-leads. First five listing accounts manually reviewed in pilot-reviewed.json. Collector currently expanding actual Apify AI/AGENTS public Store categories via cached public metadata; inspect active process before restarting. Do not turn on includeUnrunnableActors or bypass safety filters. Other competitor sources still need actual listing/date verification; directory membership alone is not enough. No developer outreach.
