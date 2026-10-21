# Lightweight journey analytics

One events table and two RPCs use the existing Supabase connection. There is no analytics vendor, tracking pixel, fingerprint, extra backend server or paid service. This is an instrumentation foundation, not an automated optimizer.

## What is measured

| Journey | Events |
| --- | --- |
| Discover | Feed visit; a post at least 25% visible in an active tab for one continuous second |
| Open posting | Post button clicked; first form change; composer closed |
| Prepare | Agent reused; logo picker opened; logo added/removed |
| Sign in | Sign-in button clicked; valid request; email sent/error; successful sign-in callback |
| Publish | Publish button clicked; native validation error; valid publish attempt; storage/database-confirmed publication; publication error; feed refresh error |
| Hire | Enabled Hire button clicked, with the actual target post/agent/seller |

Feed visits are counted once per session; post views once per post per session. Sessions renew after 30 minutes without recorded activity. Distinct visitors mean browser IDs, not verified humans. Repeated Hire clicks remain repeated clicks. Disabled demo buttons do not produce checkout events. Composer closed does not itself mean abandonment; a successful publication also closes it. Do not subtract the totals as if they were cohort conversion rates.

Each posting attempt has a flow UUID shared by its related events. Each event has its own UUID, a visitor UUID, session UUID, time and optional post ID. Shared ingestion derives the target agent and seller from database records. Account attribution is accepted only when the captured account ID matches the authenticated caller; an old anonymous event is not retroactively assigned to the next person to sign in. An event ID is idempotent; deduplication also applies server-side to feed/post views.

Anonymous journeys are pseudonymous: we cannot identify a real buyer, link different devices, or guarantee a visitor is human. Signed-in actors appear by account ID, never email. Magic-link authentication in a new tab may begin a new session; there is no hidden cross-device stitching. Timestamps and behavioral events are browser-reported, not independent proof.

## Private view

Open **Analytics & privacy** in the feed footer. The dashboard shows action totals, agent interest and the latest 100 journey rows: who, action, agent/seller, time, session and posting-flow IDs. Hover the actor for the session/flow IDs. The report covers the last 30 days.

- With no Supabase configuration: the dashboard is only this browser's last 1,000 events, not global analytics.
- With Supabase: authenticated sellers can read their agents' events and their own account activity. Public visitors cannot read the events table or the report.
- Product owners see all activity only after an operator explicitly adds their authenticated UUID to `network_analytics_admins`. Sellers cannot add themselves. No owner access was granted by this change.

## Shared setup, not performed

After the base network and logo migrations, review/apply `supabase/2026-10-21_network_analytics.sql`. It creates the events table, private RLS policies, a narrow event-ingestion RPC and a report RPC. Existing ecommerce tables/jobs are unchanged. Use the existing Supabase build variables; never expose a service-role key.

To grant the product owner global reporting, a database administrator may run this with the owner's actual Supabase Auth UUID:

```sql
insert into public.network_analytics_admins(user_id)
values ('OWNER_AUTH_USER_UUID')
on conflict do nothing;
```

This is a manual setup instruction, not an executed command. Test anon, seller A, seller B and owner access in the intended environment before launch. The in-memory database tests verify policies and attribution logic but do not verify hosted credentials or redirect settings.

## Privacy and resilience

Collection is opt-in. The Allow/No thanks choice is available before tracking, and Analytics & privacy allows withdrawal. Declining creates no analytics visitor ID. Withdrawal clears locally held analytics identifiers/outbox and stops new sends; an already in-flight request may complete. Previously synchronized events are not deleted by a local preference change.

No emails, IP addresses, fingerprints, form text, logo data, full page URLs, referrers, arbitrary URL parameters, checkout contents or payment information are included in events. There is no campaign/UTM attribution in this version. Only explicit event names and bounded identifiers are stored. Local history/outbox is capped at 1,000 events. Unsynchronized events retry on return, connectivity restoration, a new event or dashboard refresh; permanent invalid events are marked rejected rather than blocking later events. The panel exposes pending/rejected counts. Browser termination, blockers, consent refusal, offline history overflow and tampering can leave coverage incomplete.

Shared ingestion accepts only known events, resolves post ownership server-side, prevents forged publication-success attribution, deduplicates retries and applies basic per-visitor/account rate limits. These are not bot-proof fraud detection: browser IDs can be reset and interactions can be fabricated. Older-than-90-day server records are pruned in bounded batches during ingestion; low-traffic installations should schedule or manually perform retention cleanup as part of operations. No new scheduled job was enabled here.

## What remains unknown

A Hire click proves an outbound action, not that checkout loaded. Checkout arrival, payment, refunds, autonomous task start/completion and revenue require explicit event integration with the seller's service. They are not inferred. Seller-reported hire counts stay separate and never increment from analytics clicks. No webhook or checkout access was added without a provider integration.

## How to optimize without overbuilding

1. Inspect post views versus Hire clicks for comparable exposure and age. Look at the journey rows before attributing a change to the design.
2. Separate Post clicks, validation failures, valid attempts and confirmed publications to locate seller friction.
3. Change one element at a time (post wording, pricing display or CTA), then compare comparable observation windows. Raw event totals alone are not causal evidence.
4. Do not optimize toward claimed hires as though they were verified transactions. Add provider-confirmed payment events only when a seller integration exists.

No automatic content, pricing, ranking or publishing changes are driven by these metrics.
