# Two versions, one safe switch

- **v1 / ecommerce**: the original AI employees for Shopify. The original `index.html`, `app.html`, `src/App.tsx`, auth, tools, assets and public pages remain in place.
- **v2 / cofounder**: AI co-founder marketing pages in `versions/cofounder/` and a separate workspace in `src/cofounder/`. The current design is one co-founder, Evo, with a shared conversation across product, engineering, sales, marketing and finance. It reuses the same avatar, butterfly, brand styles, authenticated AI proxy, message renderer and voice components.

The default published experience is selected in **site-version.json**. It is a build setting, not a public query parameter; visitors cannot switch versions or access ecommerce tools through the co-founder UI.

## Switch and publish

```sh
npm run version:v1    # ecommerce
# OR
npm run version:v2    # cofounder
npm run build
npm run test:versions
```

Commit the `site-version.json` change and push to the production branch (`main`). The existing Vercel integration builds and publishes the selected version. Verify the Vercel deployment status before declaring the switch live. Both source versions stay available, so switching back never discards v2 work. No database migration, reset, force push or credential rotation is involved.

A temporary build override is also available: `EVOLUTION_SITE_VERSION=ecommerce npm run build`. Check that a Vercel environment override is not masking the committed selection if a deployed version differs.

## Original restore point

Exact pre-pivot commit: `b02c7440c80667f6ccf21ec44403b85ee52a6492`.
Remote branch: `versions/v1-ecommerce`.
Tag: `evolution-v1-ecommerce-2026-10-17`.

These preserve the original site independently of later changes. For a literal historical restore rather than the normal one-setting switch, make a new branch from that tag and review/deploy it. Do not reset or force-push main.

## What is isolated

V2 overlays home/app at Vite’s HTML transform stage; it does not rewrite v1 source files. Its public pages and sitemap replace ecommerce-specific output at build time. V2 does not run the ecommerce blog generator, and generated legacy articles are excluded from the v2 output. The original articles and generator remain available for v1.

V2 has its own browser-storage namespace, further separated by the signed-in email. V1 store records, entitlements, queues, payments, API routes, scheduled jobs and credentials are not migrated or deleted. Existing scheduled ecommerce backend jobs remain configured; they are not new co-founder work. Pause those separately if retiring the ecommerce service entirely.

## Honest v2 capability boundary

The hosted co-founder uses the existing server-only AI key and Supabase sign-in. No additional credentials are embedded or requested in chat. Without a working AI connection it displays an error, rather than answering from the ecommerce demo catalog. No new subscription or payment is enabled.

Idea → proposed MVP → founder approval → one shared conversation. The current design is a shared desk beside a quiet, attentive avatar. Our desk leads with the founder’s actual idea, an evidence-based five-milestone scale (idea, plan, approval, draft, build) and one next task with a named owner; conversation is a secondary tab, with notes opened only when needed. Decorative orbit icons, stars, slogans and generic assistant greetings have been removed. Activity opens a browser-local record with actor, time, request outcome and linked reply. A draft milestone requires a completed draft request linked to its saved response. Ordinary replies cannot complete it, and the build milestone stays pending until real execution can be verified. Only stored replies and explicit approvals count; failures, stopped requests and interrupted sessions do not count as completed output. My business retains the plan, focus areas and previous role history. Optional name and guidance preferences are saved locally and used as context; Evo does not invent personal knowledge. Legacy role chats are retained in the business details and download. Plans, specs, code and launch copy are chat deliverables, downloadable as Markdown. This version does not execute repository code, deploy generated products or send outreach. It makes that boundary explicit on the homepage, FAQ and workspace. Conversation state is browser-local, not a new cloud project database.

## Checks

`npm run build` type-checks both applications and builds the selected version. `npm run test:versions` verifies preserved v1 source against the tag, strict version selection, current co-founder routes and built output. `npm run test:cofounder` verifies the shared context, authenticated proxy, response delivery and failure/retry behavior without external credentials. Existing role regression tests remain available unchanged.


### First-feedback workspace

V2 now leads with product → early users → feedback, keeping the avatar and one next task visible while planning checkpoints stay in Build details. The landing page uses the same positioning: less time between the idea and real customer feedback. The workspace supports browser-local, founder-entered launch dates, early-user stages, feedback quotes and source links. Invitations do not count as people who tried the product. Feedback counts only for recorded trials. Launch-to-feedback time uses the earliest dated product feedback after the recorded launch; missing evidence displays “Not measured”. These are manual records, not connected analytics or verified testimonials. The Markdown export includes the records. No backend, sending, model connection, billing or autonomous execution was added in this design change.
