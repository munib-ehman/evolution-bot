---
title: 13-Week Cash Flow Forecast for Ecommerce Stores
description: Build a practical 13-week cash flow forecast for your ecommerce store. Map payouts, inventory, refunds, ads, and bills before a cash shortfall arrives.
slug: ecommerce-13-week-cash-flow-forecast
date: 2026-10-11
---

A 13-week cash flow forecast answers a narrower, more urgent question than a profit report: on which week could the business run short of usable cash?

Use one column per week. Start with the cash actually available, add receipts when they are expected to reach the bank, subtract payments when they are expected to leave, and carry the ending balance into the next week. Update actuals every week and move the window forward.

This is a short-term operating tool, not a replacement for bookkeeping, tax advice, or a full financial model. Its value is timing. A profitable month can still contain a week when inventory, ad spend, refunds, and payroll leave the bank before sales payouts arrive.

## Use cash dates, not order dates

Revenue is not cash in the bank. An order can appear in a sales report before its payment is captured or paid out. Shopify explains that its Sales and Payments finance reports can differ because they record different events and time periods; the [finance reports documentation](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report) also points merchants to the Shopify Payments activity report for reconciling balance activity with deposits.

For the forecast, record each flow on the date you expect the bank balance to change:

- customer receipts on expected payout or settlement dates
- supplier deposits and balances on their contractual due dates
- ad-platform charges when the card or account will be debited
- payroll and contractor payments on pay dates
- tax transfers and remittances on their actual deadlines
- rent, software, debt payments, and owner draws when they leave the account
- refunds and chargebacks when they reduce a payout or bank balance

Shopify's current [payout timing guide](https://help.shopify.com/en/manual/payments/shopify-payments/payouts/payout-timing) notes that settlement varies by region, risk level, and payment method; weekends and holidays affect business-day timing, and a bank can add processing time after a payout is sent. Use the schedule and pending-payout view for your store instead of a generic delay assumption.

## Build the sheet in eight rows

Create 13 weekly columns, beginning with the current week, plus a notes column. The simplest useful sheet has these sections:

1. beginning cash
2. customer and other cash receipts
3. inventory and freight payments
4. variable operating payments
5. fixed operating payments
6. tax, debt, and owner payments
7. ending cash
8. minimum cash buffer and headroom

Use this formula in each weekly column:

> Ending cash = beginning cash + cash receipts − cash payments

Then:

> Cash headroom = ending cash − minimum cash buffer

Next week's beginning cash equals this week's ending cash. If you keep separate operating, tax, and reserve accounts, either forecast each account separately or make clear which balances are unavailable for normal spending.

## Start with a bank-reconciled opening balance

Do not begin with the cash figure you remember from yesterday. Reconcile the bank, then adjust for items that have already been initiated but not cleared.

List:

- current bank balances available for operations
- payouts already initiated but not deposited
- card or bank payments already authorized but not cleared
- checks, transfers, or refunds in flight
- restricted tax or reserve balances that should not fund ordinary expenses

The forecast fails quickly when the opening number double-counts a pending payout or ignores a card balance due tomorrow.

## Forecast receipts from the bottom up

For the first two to four weeks, use known information wherever possible:

- Shopify Payments pending payouts
- other processor settlement reports
- wholesale invoices with realistic collection dates
- approved financing draws
- confirmed insurance, tax, or vendor refunds

For later weeks, forecast store receipts from order demand, capture rate, refunds, processor deductions, and payout timing. Keep the assumptions visible.

A practical estimate is:

> Expected cash receipts = expected captured sales − refunds − processor deductions − expected dispute impact, shifted to expected bank dates

Do not forecast gross merchandise value as cash if taxes, discounts, refunds, or payment fees will reduce what arrives. Compare the sales assumption with your [demand forecast](/blog/forecast-demand-small-ecommerce-store), but translate demand into deposits rather than copying revenue directly.

Create base, lower, and higher receipt cases when demand is uncertain. The lower case should be plausible, not theatrical. Its purpose is to reveal which payment you would delay or reduce if sales underperform.

## Put inventory on its real payment schedule

Inventory usually creates the largest timing error because the purchase order date, production date, ship date, and cash dates are not the same.

For every open or planned purchase order, record:

- supplier and purchase order number
- deposit amount and due date
- balance amount and due date
- freight, duty, inspection, and receiving payments
- whether the date is contractual, confirmed, or estimated
- the sales period the inventory is meant to support

Your inventory plan might say the units are needed; the cash forecast decides whether the order and its terms fit. Link the purchase decision to the existing [inventory-planning routine](/blog/inventory-planning-solo-store-owners), then test the deposit and balance against weekly headroom.

If a large order breaks the buffer, the decision is not automatically “do not buy.” Options can include reducing quantity, splitting delivery, negotiating payment milestones, delaying a lower-priority SKU, or arranging financing before the due date. Put only agreed terms into the base case.

## Include the outflows stores routinely miss

Use bank and card history to find irregular costs. Typical categories include:

### Variable operations

- product cost and packaging
- freight, duties, fulfillment, and shipping labels
- payment processing and marketplace fees
- performance marketing
- refunds, replacements, and chargebacks
- usage-priced apps or support tools

### Fixed operations

- Shopify plan and recurring apps
- payroll, contractors, and agencies
- rent, storage, insurance, and professional services
- loan or financing payments
- scheduled owner compensation

### Periodic and event-driven items

- tax remittances
- annual subscriptions and renewals
- equipment or theme work
- launch samples and creative production
- seasonal inventory deposits
- customer credits that are likely to be redeemed

Shopify's [billing-cycle documentation](https://help.shopify.com/en/manual/your-account/manage-billing/managing-your-bills/viewing-your-bills/billing-cycles-thresholds) explains that subscription and app charges can follow different cycles, and threshold billing can trigger a bill before the normal cycle. Use your actual next-bill data rather than assuming every software charge lands on the first of the month.

For a cleaner cost baseline, reconcile the forecast with your [true profit per order](/blog/true-profit-per-order-not-just-revenue). Profit analysis catches costs that belong to an order; the cash sheet places those costs in the week they are paid.

## A worked 4-week example

The following numbers are fictional and simplified. They show the mechanics, not a benchmark for what a store should hold.

|  | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---:|---:|---:|---:|
| Beginning cash | $28,000 | $27,500 | $24,000 | $14,500 |
| Customer receipts | $18,000 | $20,000 | $21,000 | $19,000 |
| Other receipts | $0 | $0 | $0 | $0 |
| Inventory and freight | ($6,000) | ($12,000) | ($18,000) | ($5,000) |
| Ads and variable operations | ($7,500) | ($7,500) | ($7,500) | ($7,000) |
| Fixed operations | ($5,000) | ($4,000) | ($4,000) | ($4,000) |
| Tax, debt, owner payments | $0 | $0 | ($1,000) | ($1,000) |
| Ending cash | $27,500 | $24,000 | $14,500 | $16,500 |
| Buffer | $15,000 | $15,000 | $15,000 | $15,000 |
| Headroom | $12,500 | $9,000 | **($500)** | $1,500 |

The four-week total remains cash-positive, but week 3 falls below the chosen buffer because the inventory balance and regular operating costs land together. That is the action signal. The owner has time to confirm the receipt assumptions, change the supplier schedule, reduce a discretionary payment, or arrange appropriate funding before week 3 arrives.

## Set a buffer with a reason

There is no universal cash-buffer percentage. Choose a floor based on payments that cannot safely be delayed and risks that actually exist in the business.

One approach is to total a defined period of essential payments—such as payroll, committed supplier balances, fulfillment, debt, and taxes—then add exposure for plausible refunds, chargebacks, or payout delays. Document what the buffer covers.

Keep the buffer separate from “whatever is left.” When ending cash crosses it, the forecast should trigger a decision rule such as:

- owner approval required for uncommitted spending
- freeze on new experiments or app purchases
- supplier-term review
- lower ad-spend ceiling until receipts recover
- financing conversation before the balance turns negative

The rule should happen while options remain, not after a payment fails.

## Update it on the same day every week

A forecast becomes useful through repetition:

1. replace last week's estimates with actual bank movements
2. explain material differences in a variance note
3. update the next 12 weeks with new payout, purchase order, and billing information
4. add a new week 13
5. review the lowest ending balance and first buffer breach
6. assign decisions, owners, and dates

Track forecast error by category. If sales receipts are consistently late, change the timing assumption. If refunds are consistently higher, change the amount. If supplier dates move every week, make that uncertainty visible rather than repeatedly overwriting the old date.

SCORE Houston's [12-month cash flow projection template](https://www.score.org/tx/houston/templates/12-month-cash-flow-projection-template-score-houston/), published July 15, 2026, is a useful longer-range companion covering receipts, operating expenses, and ending balances. The 13-week sheet serves a different cadence: weekly decisions close enough to act on.

## What the forecast should change

The sheet is finished only when it changes a decision. At the weekly review, answer:

- What is the lowest projected cash balance and in which week?
- Which receipts are assumptions rather than scheduled deposits?
- Which large payments are committed, and which remain negotiable?
- What happens in the lower-sales case?
- Which decision must be made this week to protect the buffer?

Start today with 13 empty weekly columns and the bank-reconciled opening balance. Add known payouts and committed payments first. A rough forecast tied to real dates is more useful than a beautiful monthly model that hides next Tuesday's shortfall.
