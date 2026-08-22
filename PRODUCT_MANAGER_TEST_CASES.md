# Product Manager End-to-End Test Cases

## Test environment

- Operator account with a connected Shopify development store.
- At least six products: one complete seller, one thin listing, one sold-out product, one product younger than 90 days, one old product with no sales, and one product appearing in abandoned checkouts.
- One manual collection and one automated collection.
- Apply `supabase/2026-08-15_product_manager.sql` before testing persistence or lifecycle actions.
- Use test products only. Do not approve archive actions against production merchandise.

## Role and dashboard

| ID | Scenario | User steps | Expected result |
|---|---|---|---|
| PM-001 | Open role | Sign in, connect Shopify, select **Product Manager**. | Product Manager opens with its own greeting, catalog metrics, priority, and three responsibilities. |
| PM-002 | Role isolation | Ask Product Manager to optimize a product for SEO. | It explains that SEO title/meta belong to SEO Manager; it may discuss the storefront listing but must not prepare SEO metadata. |
| PM-003 | Live snapshot | Compare displayed products with Shopify Admin. | Titles/statuses match Shopify; readiness and issue reasons are visible; page conversion is never claimed. |
| PM-004 | Missing order permission | Reconnect without usable order access or simulate an order API failure. | Dashboard still shows listing issues, marks sales signals unavailable, and never exposes Archive approval. |
| PM-005 | Empty catalog | Connect an empty development store. | Zero-state explains that no products are available; controls do not crash or invent priorities. |

## Product research and launch draft

| ID | Scenario | User steps | Expected result |
|---|---|---|---|
| PM-101 | Market selection | Select US, Canada, then GCC and run a hunt for each. | The selected market is sent with the run and appears in the saved report/evidence. |
| PM-102 | Three candidates | Run product research. | Exactly three distinct products appear with fit, demand evidence, sourcing, suggested price, and source links. |
| PM-103 | Source safety | Open every research and supplier link. | Research links resolve to real pages; supplier links are safe search URLs rather than fabricated product IDs. |
| PM-104 | Catalog duplicate prevention | Inspect candidate names against the connected catalog. | The role does not recommend a product already sold by the store. |
| PM-105 | Prepare draft | Click **Prepare Shopify draft** on a candidate. | An Action proposal appears; no Shopify product exists yet. It shows title, numeric price, private sourcing evidence, and media/sample warnings. |
| PM-106 | Approve draft | Approve a draft on a development store. | Shopify receives one `DRAFT` product with shopper copy and initial variant price; it is not published and has no supplier image imports. |
| PM-107 | Reject draft | Prepare another candidate and reject it. | Proposal becomes rejected and Shopify remains unchanged. |
| PM-108 | Invalid researched price | Use a report whose price has no numeric value. | Draft preparation is blocked with an actionable price-confirmation message. |
| PM-109 | Provider/source failure | Simulate research provider failure or unavailable sources. | Progress ends in a visible retryable error; no malformed run or action is created. |

## Listing optimization

| ID | Scenario | User steps | Expected result |
|---|---|---|---|
| PM-201 | Prioritize thin listing | Choose the product with missing/thin copy and click **Prepare listing update**. | Proposal contains shopper-visible title/body/tags only, plus safe missing-alt updates. SEO title/meta are absent. |
| PM-202 | Unsupported facts | Use a product with no description, vendor, type, tags, or confirmed facts. | Optimizer refuses to rewrite and requests verified product facts instead of inventing claims. |
| PM-203 | Before/after preview | Open the prepared Action. | Current and proposed values are readable; merchant can edit storefront title/body/tags before approval. |
| PM-204 | Stale preflight | Prepare a proposal, then edit the same product in Shopify before approval. | Approval is rejected as stale; the newer Shopify change is not overwritten. |
| PM-205 | Apply listing | Approve a valid development-store proposal. | Shopify title/body/tags update; missing image alt uses only the verified product title; action becomes succeeded or partial with errors shown. |
| PM-206 | SEO boundary regression | Compare SEO title/meta before and after PM approval. | SEO title and meta description remain unchanged. |
| PM-207 | Undo listing | Click Undo within 24 hours without further Shopify edits. | Original storefront fields and alt text are restored. |
| PM-208 | Unsafe undo | Apply an update, then edit the product in Shopify and try Undo. | Undo is blocked to protect the newer Shopify state. |

## Merchandising and lifecycle

| ID | Scenario | User steps | Expected result |
|---|---|---|---|
| PM-301 | Create collection | Choose products, arrange order, prepare and approve a new collection. | A manual collection is created, membership matches the proposal, and the desired ordering mutation is queued. |
| PM-302 | Update collection | Select an existing manual collection, add/remove/reorder products, then approve. | Metadata and membership update without passing product IDs as invalid collection input; failures are visible. |
| PM-303 | Automated collection safety | Inspect an automated collection. | The role does not silently replace its rules or convert it; manual ordering is unavailable or a new manual collection is recommended. |
| PM-304 | Collection stale preflight | Prepare an update, modify the collection in Shopify, then approve. | Proposal becomes stale and does not overwrite the Shopify edit. |
| PM-305 | Bundle hypothesis | Open a store with fewer than five joint orders for a pair. | Bundle is explicitly labeled a hypothesis/recommendation; no Shopify bundle is created. |
| PM-306 | Archive eligible | Use an active product older than 90 days with zero units in 90 days and zero abandoned appearances in 30 days. | **Prepare archive** is available, but Shopify remains unchanged until approval. Warning explains missing page-view evidence and current inventory risk. |
| PM-307 | Archive blocked by sales | Try the archive endpoint for a product with a recent sale. | Server returns conflict and creates no action even if the browser request is manipulated. |
| PM-308 | Archive blocked by abandonment | Try an old zero-sale product that appears in a recent abandoned checkout. | Archive is blocked server-side. |
| PM-309 | Archive blocked by age/data | Try a product younger than 90 days or with unavailable order/checkout data. | Archive is blocked server-side. |
| PM-310 | Approve and undo archive | Approve an eligible test-product archive, then Undo within 24 hours. | Status changes to `ARCHIVED`, then restores to the exact previous status. |

## Persistence, scheduling, and resilience

| ID | Scenario | User steps | Expected result |
|---|---|---|---|
| PM-401 | Refresh persistence | Run research and a catalog scan, then reload. | Latest research and current action history remain available and owner-scoped. |
| PM-402 | Weekly idempotency | Invoke weekly scan twice for the same shop/week. | One snapshot row exists; the second run updates/reuses it rather than duplicating it. |
| PM-403 | Cron authentication | Call weekly endpoint without `CRON_SECRET`. | Request returns 401 and saves nothing. |
| PM-404 | Multi-tenant isolation | Sign in as a second test merchant. | First merchant’s research, snapshots, and actions are inaccessible. |
| PM-405 | Shopify throttling/network failure | Simulate Shopify GraphQL failure during analysis or execution. | UI reports unavailable/failed state, stays retryable, and never reports success. |
| PM-406 | Duplicate approval | Double-click or replay the approval request. | Idempotency and status locking execute the Shopify action at most once. |

## Release gate

Release only when automated tests, typecheck, production build, and the connected-store happy paths PM-001, PM-105–107, PM-201–208, PM-301–304, and PM-306–310 pass. Record Shopify IDs used during testing and clean up only test products/collections after verification.
