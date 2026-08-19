---
title: Inventory Planning for Solo Store Owners — Avoid Stockouts and Dead Stock
description: A practical inventory planning system for solo store owners using sales velocity, lead time, reorder points, and a weekly routine to control stock.
slug: inventory-planning-solo-store-owners
date: 2026-08-18
---

Inventory has an annoying habit of being wrong in both directions at once. Your best seller runs out on Friday, while three slow products sit on a shelf tying up cash you need for the reorder.

For a solo store owner, the answer is not a giant forecasting spreadsheet. It is a small system that tells you what is selling, how long replenishment really takes, and which decision needs your attention this week. The aim is not perfect prediction. It is noticing risk early enough to act.

## Start with inventory you can trust

A reorder calculation built on a bad stock count only creates a more precise mistake. Make sure every product and variant has a unique SKU, inventory tracking is enabled, and stock is assigned to the location where it physically sits. Shopify's [inventory tracking guidance](https://help.shopify.com/en/manual/products/inventory/getting-started-with-inventory/inventory-tracking) explains how tracked quantities and inventory history work.

Do a full count to establish a clean starting point, then cycle-count a manageable section of inventory each week. Investigate differences instead of quietly overwriting them. Common causes include returns placed back on the shelf but not in the system, damaged units that were never adjusted, bundles that do not decrement their components, and orders fulfilled from the wrong location.

Keep these quantities separate:

- **On hand:** physically present, including units that might already be committed
- **Available:** stock that can still be sold
- **Incoming:** ordered but not yet received
- **Committed:** allocated to open orders

Shopify documents these [inventory states](https://help.shopify.com/en/manual/products/inventory/getting-started-with-inventory/inventory-states). Looking only at “on hand” can make stock appear safer than it is.

## Plan by SKU, not by product

A shirt can look healthy in total while its medium black variant is about to sell out. Reorder decisions belong at the SKU level because each size, color, or configuration has its own demand and available quantity.

For every active SKU, record five inputs:

1. available units
2. incoming units and expected arrival dates
3. recent units sold per day or week
4. replenishment lead time
5. a safety-stock allowance

Start with trailing sales from a period that resembles the weeks ahead. Thirty days can work for steady sellers; a longer window can calm down noisy low-volume products. Do not blindly average across a seasonal launch, a stockout, or a promotion. Add a note when history is not representative.

Shopify's [inventory reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/inventory-reports) include measures such as sell-through rate, days of inventory remaining, and ABC product analysis where those reports are available on your plan. Use them as decision inputs, not commands: the system cannot know that a supplier is closing for a holiday or that next month's campaign features one specific SKU unless you account for it.

## Calculate a simple reorder point

Use this basic formula:

> Reorder point = expected demand during lead time + safety stock

Suppose a SKU sells an average of 2 units a day, replenishment takes 21 days, and you hold 14 units of safety stock:

> (2 × 21) + 14 = 56 units

When the SKU's inventory position reaches 56, it is time to place the next order. For this decision, inventory position should include available and reliable incoming stock, then subtract any demand or commitments not already reflected in those numbers. Use the same definition every week so you do not count a purchase order twice.

The reorder point tells you **when** to buy. It does not tell you **how much**. For a small store, a practical order quantity is enough to cover demand until the next planned order review, plus the following lead-time window and safety stock, minus usable stock already available or incoming. Then check the supplier's minimum, case pack, expiry risk, storage space, and the cash you can actually afford to commit.

## Measure lead time from your own purchase orders

The lead time in a supplier quote is often production time, not the full wait. Track the calendar days from placing the purchase order until the units are received and ready to sell. That can include approval, production, freight, customs, receiving, inspection, and labeling.

Record both the promised date and the actual ready-to-sell date for every order. Shopify's [purchase order documentation](https://help.shopify.com/en/manual/products/inventory/purchase-orders) describes how purchase orders can track incoming inventory, supplier details, quantities, costs, and estimated arrival dates.

Use a realistic recent lead time in your reorder point, not the supplier's best-ever result. If lead times vary substantially, that uncertainty belongs in safety stock.

## Set safety stock deliberately

Safety stock protects you from demand running higher than expected or supply arriving later than expected. There is no universal number that works for every SKU.

Start small and use judgment:

- add more for high-margin best sellers with unreliable lead times
- add less for bulky, perishable, seasonal, or easily substituted products
- add none for products you intend to discontinue
- revisit it after a late delivery, promotion, or sustained change in sales velocity

Do not use safety stock to hide a broken supplier relationship. If every shipment is late, update the lead time and address the supplier problem rather than pretending the delay is an exception.

## Separate winners from cash traps

Not every SKU deserves the same amount of attention or capital. Group inventory into three working buckets:

- **Core:** frequent sellers or products whose absence damages the customer experience
- **Watch:** uneven sellers that need smaller orders and closer review
- **Exit:** products with little demand, poor margin, or no strategic reason to keep stocking

ABC analysis can provide a starting point by grouping products according to their contribution to revenue. But revenue alone does not make an item worth replenishing. Check [true profit per order](/blog/true-profit-per-order-not-just-revenue), return rates, and operational complexity before giving a SKU more cash.

For dead stock, stop reordering first. Then choose a deliberate exit: bundle it with a complementary seller, merchandise it to the right audience, return it to the supplier if your agreement allows, or discount it with a deadline. Moving old inventory is usually better than letting it occupy cash and shelf space indefinitely, but do not train customers to wait for constant clearance pricing.

## Account for stockout-distorted demand

Sales history records what customers could buy, not everything they wanted to buy. If a SKU was unavailable for ten days, its monthly units sold will understate demand. Mark stockout dates and treat in-stock days separately when estimating velocity.

Back-in-stock signups, product-page visits while unavailable, customer questions, and substituted purchases can all show demand that completed-order data missed. A [back-in-stock alert](/blog/back-in-stock-alerts-recovering-lost-sales) also gives shoppers a route back while you fix the planning gap.

## Use a 30-minute weekly inventory review

Put the review on the calendar at the same time every week:

1. **Fix exceptions:** negative stock, untracked variants, overdue purchase orders, and count discrepancies.
2. **Review reorder risk:** SKUs at or below their reorder point, sorted by days of inventory remaining.
3. **Review incoming stock:** confirm dates for orders that must arrive before the next review window.
4. **Review slow stock:** flag products with no recent sales or steadily worsening sell-through.
5. **Record decisions:** order, wait, expedite, transfer, bundle, discount, or discontinue.

During a promotion or seasonal peak, shorten the review cycle for featured and fast-moving SKUs. Outside those periods, consistency matters more than complexity.

## The one-page inventory plan

Your working sheet only needs one row per SKU and these columns:

- SKU and product name
- available and incoming units
- average units sold per day
- actual lead time in days
- safety stock
- reorder point
- estimated days remaining
- next action and review date

Color can help, but the action column is the important part. A dashboard that turns red without telling you what to do is just another tab to ignore.

Inventory planning for a small store is a rhythm: count accurately, calculate consistently, review exceptions, and keep a record of what happened. Do that once a week and you will not eliminate every stockout or slow seller. You will catch far more of them while there is still time—and cash—to make a sensible decision.
