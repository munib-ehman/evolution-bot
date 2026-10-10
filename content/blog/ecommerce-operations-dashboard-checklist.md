---
title: Ecommerce Operations Dashboard: Daily, Weekly, Monthly Checks
description: Build a useful ecommerce operations dashboard with daily exceptions, weekly trends, monthly economics, clear owners, and actions for every metric that matters.
slug: ecommerce-operations-dashboard-checklist
date: 2026-10-10
---

An ecommerce operations dashboard should answer three questions: What needs attention today? What pattern should change this week? Is the business economically healthier this month?

Do not put every available metric on one screen. Build three review layers—daily, weekly, and monthly—and give every card an owner, comparison, threshold, and next action. If a number cannot change a decision, it belongs in a report you open when needed, not on the operating dashboard.

## Start with decisions, not charts

Write the decision before choosing the metric.

| Decision | Metric or signal | Owner action |
|---|---|---|
| Is checkout working? | checkout starts, completions, payment failures | verify, contain, or escalate |
| Will an order miss its promise? | aging unfulfilled orders | prioritize or contact customer |
| Are we about to run out? | days of inventory, lead time, incoming stock | review reorder or expedite |
| Is acquisition affordable? | contribution after marketing spend | hold, reduce, or test more spend |
| Is service improving? | response commitments, repeat contacts, returns | fix answer, policy, or product evidence |

Then define the card:

- exact metric and formula
- source of truth
- date range and comparison period
- useful segments
- threshold or review condition
- owner and response time
- link to the diagnostic report or playbook

Shopify's current [Analytics overview](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard) supports customizable metric cards, labeled sections, comparisons, insights, and targets. Use that flexibility to build a review surface, not a wall of numbers.

## Daily dashboard: exceptions that can cost an order or customer

The daily view should be short enough to scan before fulfillment begins. It is not yesterday's executive summary.

### Orders and checkout

Show:

- orders and completed checkouts against a relevant recent baseline
- checkout starts without expected completions
- failed, risky, or manual-payment orders that need review
- unusually high discounts or refunds
- test orders or internal activity that should be excluded

The Shopify [conversion-rate breakdown report](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/behaviour-reports) follows sessions through cart additions, checkout, and completed checkout. Monitor counts as well as rates. A 100% rate change based on two sessions is not an incident.

Use a minimum-volume gate and compare like periods. Tuesday morning should usually be compared with recent Tuesday mornings, not a weekend launch. If checkout starts remain normal while completions disappear, open the response steps in the [checkout anomaly alert guide](/blog/ecommerce-checkout-anomaly-alerts).

### Fulfillment and customer risk

Show only exceptions:

- unfulfilled orders older than the store's normal handling window
- shipments without an expected scan or update
- delivery exceptions that need a customer message
- address, fraud, or payment issues awaiting a decision
- high-priority support conversations approaching the promised response time

Do not create a universal “late” rule by copying another store. A made-to-order product, a same-day promise, and an international preorder have different clocks. Store the promised service level with the order or workflow so the dashboard can compare the right expectation.

### Inventory and campaign failures

Show:

- core SKUs below a review threshold
- negative or unexplained quantities
- overdue purchase orders
- an automation or campaign that failed, stopped, or used outdated content

A low-stock number without supplier lead time and incoming inventory is incomplete. Use it as an exception to review, not an automatic purchase instruction.

End the daily view with three queues: **act now**, **approve**, and **monitor**. Every item should leave the dashboard when it is resolved, not remain red forever.

## Weekly dashboard: trends and operating capacity

The weekly view is for patterns too noisy to judge every day.

### Funnel movement by useful segment

Track:

- sessions, cart additions, checkout starts, and completed checkout
- conversion by device, market, top landing page, and new versus returning visitor where useful
- top products by units and net sales
- stockouts or unavailable variants affecting high-traffic pages

Use the same definitions and comparison window each week. Annotate launches, promotions, theme changes, tracking changes, and stockouts.

There is an important current measurement break to record: Shopify says a session-measurement update rolled out from **September 21 through September 23, 2026**, and warns that sessions, conversion rate, and other session-based metrics can change without customer behavior changing. Do not interpret a line crossing that event as a store improvement or decline until you review the definition and affected period.

The [guide to misleading Shopify metrics](/blog/shopify-analytics-misleading-metrics) explains why conversion, average order value, returning-customer rate, and attributed sales need paired checks.

### Inventory health

Track at SKU level:

- days of inventory remaining
- sales velocity and in-stock days
- incoming units and confirmed arrival dates
- products with no recent movement
- stockouts, backorders, and count discrepancies

Shopify's current [inventory-report documentation](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports) says its days-of-inventory estimate divides remaining inventory by average units sold per day and uses a recent sales window. It also documents a second current measurement change: beginning **October 1, 2026**, inventory reports use **On hand** rather than **Available** quantity. On hand includes committed and unavailable units, so the displayed quantity can be higher even though sellable stock did not increase.

Annotate that event and keep operational definitions explicit. The [solo-store inventory planning system](/blog/inventory-planning-solo-store-owners) adds supplier lead time, safety stock, and incoming orders to the dashboard number.

### Customer experience and workload

Track:

- conversations by reason, not just total ticket count
- response commitments met
- repeat contacts on the same issue
- return reasons by product and variant
- refunds, replacements, and cancellations requiring review
- manual hours spent on repeated work

The goal is to remove a cause, not celebrate a growing queue. If “Where is my order?” repeats, improve tracking visibility or proactive updates. If one fit question drives returns, improve the product evidence before adding another response macro.

### Marketing operations

Track campaign delivery and store outcome separately:

- campaigns or flows scheduled, sent, failed, or paused
- audience and consent checks
- spend from the ad platform
- orders, net sales, discounts, and contribution from store records
- attribution model and reporting delay

Shopify's [marketing performance documentation](https://help.shopify.com/en/manual/promoting-marketing/analyze-marketing/marketing-performance) notes that marketing data can take time to update and that Shopify and connected platforms can use different attribution views. Do not add two platforms' attributed revenue together and call it total sales.

## Monthly dashboard: economics and resource allocation

The monthly review should connect operating activity to money kept and capacity created.

### Reconcile sales, profit, and cash

Show:

- gross and net sales
- discounts and sales reversals
- gross profit with the share of sales missing product cost
- fulfillment, shipping subsidy, payment, returns, and marketing costs
- contribution before fixed overhead
- payouts and cash commitments on their own schedule

Shopify's [Finance Summary documentation](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report) distinguishes sales, payments, and gross-profit reporting and notes that gross profit depends on recorded product costs. A payout is not the same thing as revenue, and gross profit is not contribution after acquisition and fulfillment.

Use the [true profit per order framework](/blog/true-profit-per-order-not-just-revenue) for representative orders and top products. Then reconcile the dashboard total with the records used for bookkeeping rather than assuming one platform contains every cost.

### Review customers and products as cohorts

Show:

- first-time and returning customers as counts and rates
- realized repeat purchase by acquisition month or first product
- time to second order
- returns and contribution by product or cohort
- products that consume disproportionate support or operational time

A rising returning-customer rate can result from fewer new customers rather than stronger retention. Pair the rate with the underlying counts and cohort behavior.

### Review the operating system itself

Show:

- recurring work completed automatically, by a person, or by the founder
- exceptions and reversals by workflow
- false alerts and missed incidents
- owner review time
- app, contractor, and agency cost by owned outcome
- access or workflows that should be removed

The monthly question is not “How busy was the system?” It is “Which capability produced a verified outcome, and which one created supervision without enough value?”

## A compact dashboard layout

Use four sections rather than one endless grid.

### 1. Today needs action

- checkout or order anomaly
- fulfillment promise at risk
- customer deadline
- inventory or campaign failure

### 2. This week is drifting

- funnel movement by useful segment
- inventory runway and slow stock
- repeated support or return reason
- marketing delivery and contribution

### 3. This month changed

- net sales, gross profit, and contribution
- new and repeat customer cohorts
- cash commitments and supplier exposure
- owner capacity and operating cost

### 4. Data quality

- last refresh time
- missing product cost or campaign spend
- tracking discrepancy
- definition or platform change
- owner of the fix

Data quality deserves a visible section. A precise chart built on missing costs or changed definitions can drive a worse decision than no chart.

## Set thresholds from the store's own baseline

Avoid universal red, yellow, and green numbers. A healthy conversion rate, response time, inventory runway, or return rate depends on product, traffic, promise, margin, season, and volume.

For each alert, require:

1. a relevant comparison period
2. enough observations to judge the change
3. an absolute impact as well as a percentage
4. a known response owner
5. a verification step

A hypothetical rule might flag checkout only when starts exceed the store's minimum sample and completion falls materially below comparable periods. The numbers must come from the store's observed distribution and risk tolerance, not from an uncited benchmark.

Review false positives monthly. If nobody acts on a card for three review cycles, either give it a decision or remove it.

## Build the first version in one afternoon

1. List the five decisions most likely to protect orders, customers, inventory, cash, and owner time.
2. Choose one authoritative source for each decision.
3. Create no more than ten daily exception cards.
4. Add weekly funnel, inventory, service, and campaign sections.
5. Add monthly contribution, cohort, cash, and operating-cost sections.
6. Write the owner and playbook link beside each alert.
7. Annotate the September 2026 session change, the October 2026 inventory change, and your own releases or promotions.
8. Test the dashboard with a known past incident: would it have surfaced the problem and pointed to the right next step?

The broader [one-afternoon Shopify audit](/blog/audit-shopify-store-one-afternoon) can help choose the first issues, but the dashboard should be smaller than the audit. Its job is to keep a short set of important decisions visible after the audit ends.

Start with today's exception queue. Once every red item has an owner and response, add the weekly trends. Add monthly economics last. A useful dashboard grows from decisions that repeatedly matter, not from every metric the platform makes available.
