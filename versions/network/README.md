# Evolution v3 — the agent work feed

One feed. Human-authored posts showing an agent's work. One outbound action to try the agent. No accounts, categories, search, likes, comments, chat, payments, or agent runtime were added.

The interface keeps Evolution's existing butterfly logo unchanged. A slim desktop sidebar and one social feed frame human-authored posts. Each post pairs a short sentence with a sage, peach or lavender agent showcase, a work sample and Try agent. The visual treatment adds no product features: the sidebar has only Feed, showcase graphics are decorative, and work samples expand inline using native details. There are no fake social counts or inactive navigation items. V1 and V2 sources remain intact.

## Local preview

```sh
npm ci
npm run version:v3
npm run dev -- --host 127.0.0.1
```

Both `/` and `/app` show the same feed. Build with `npm run build`. Run `npm run test:network` and `npm run test:versions` after building. To preview older versions without changing the committed selection, use `EVOLUTION_SITE_VERSION=cofounder npm run dev` or `EVOLUTION_SITE_VERSION=ecommerce npm run dev`.

## Add an actual agent

Manually edit `src/network/posts.json`, newest first. There is intentionally no builder onboarding UI. Supply the human owner's real name, a narrow job, required input, returned deliverable, an actual work sample, and an HTTPS link that opens the working agent itself, not a contact inbox.

Run a real task end-to-end before listing it. Confirm the task is completed and the result returned without a human operator. Only then set `autonomyTested: true` and `demo: false`. The flag records your manual check; it is not automated certification. `tryUrl` must be a valid HTTPS address, but the URL validator cannot verify that the destination actually works. Recheck it manually. Do not claim results or autonomy without evidence.

All initial posts are explicitly illustrative. Their Try buttons are disabled; sample outputs are formats, not agent-generated results. No real agents or task endpoints were supplied, so the prototype does not pretend they are connected. Replace the examples with tested agents to open the marketplace.

## Measuring interest

Outbound Try clicks on real listings are best-effort events stored only in the visitor's browser under `evolution:network:try-clicks:v1`, capped at 500. They are not shared analytics, verified usage, or paid deals. Storage failure never blocks an agent link. No personal information is collected by this feature. For the initial pilot, ask buyers/builders manually about usage and paid deals; label those reports self-reported. Central collection and payment verification are not implemented.

## Not deployed

This branch selects v3 locally and sets `git.deploymentEnabled: false` in `vercel.json` to prevent automatic Vercel publication on push. Main is unchanged. No deployment or production switch is authorized. Remove the disable setting only after a separate deployment request. Existing backend APIs and scheduled ecommerce jobs are untouched and are not used by this feed.

## Validation

V3's production build, TypeScript checks, network tests, and browser inline sample expand/collapse flow pass. The inherited `test:versions` suite fails at its historical `public/sitemap.xml` comparison: the current main-branch sitemap already differs from the v1 restore tag. This change does not modify that sitemap or weaken that assertion. V3 output isolation is also checked independently in `test:network`.
