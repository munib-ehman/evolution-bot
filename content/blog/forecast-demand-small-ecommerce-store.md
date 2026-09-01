---
title: How to Forecast Demand for a Small Ecommerce Store
description: Forecast demand without a data team using clean SKU history, in-stock sales velocity, known events, and three scenarios you can update reliably each week.
slug: forecast-demand-small-ecommerce-store
date: 2026-09-01
---

You do not need a data team to forecast demand for a small ecommerce store. You need a repeatable estimate of how many units each important SKU is likely to sell during the period you must plan, plus a range that makes uncertainty visible.

Start with in-stock sales history, adjust only for events you can name, and produce low, base, and high cases. The forecast is not the purchase order. It is one input to a buying decision that also includes stock on hand, confirmed incoming units, supplier lead time, minimum order quantities, margin, and available cash.

## Forecast only the decisions that matter

A solo owner does not need a daily prediction for every variant. Choose a planning horizon that matches the decision:

- **Next 2–4 weeks:** cash, promotions, and stock transfers
- **One supplier lead time:** whether and when to reorder
- **One seasonal window:** how much to commit before a launch or holiday

Forecast at the SKU level for products where size, color, or configuration sells differently. Group very slow or interchangeable items only when buying decisions genuinely happen as a group.

Prioritize core sellers, long-lead-time items, promotion products, and SKUs that would be expensive to overstock. The [inventory planning guide](/blog/inventory-planning-solo-store-owners) covers reorder points and safety stock; this article focuses on estimating the demand that goes into those decisions.

## Build a clean demand history

For each SKU, export or record weekly units sold for a useful comparison window. Eight to thirteen weeks is a practical starting point for a steady product, but use a longer comparable period when volume is low or seasonality is strong.

Add four flags beside the history:

1. days the SKU was out of stock
2. promotions or unusual discounts
3. launches, creator mentions, or large campaigns
4. returns, cancellations, or bulk orders that distort normal demand

Shopify's current [inventory analytics field reference](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields) includes measures such as days in stock, days out of stock, net items sold, and days of inventory remaining. Use the fields available on your plan and keep the date range and definition visible beside the calculation.

Do not treat a stockout week as low demand. Sales record what customers could buy, not everything they wanted. If a SKU sold 30 units during 15 in-stock days, a simple in-stock rate is:

> In-stock sales rate = 30 units / 15 in-stock days = 2 units per day

Back-in-stock signups and product-page traffic while unavailable can indicate missed demand, but they are not completed orders. Keep them as a separate signal rather than quietly adding every signup to the forecast. The [back-in-stock guide](/blog/back-in-stock-alerts-recovering-lost-sales) explains how to collect that intent.

## Create a baseline you can explain

For a stable SKU, use the average weekly units from recent comparable, in-stock weeks:

> Baseline weekly demand = comparable units sold / comparable in-stock weeks

Suppose a variant sold 96 units across eight usable weeks:

> 96 / 8 = 12 units per week

If the next planning period is six weeks, the unadjusted base is 72 units. That number is not yet a forecast. It still needs an honest review of what will be different.

Shopify's [inventory reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports) provide sell-through and days-of-inventory measures. Shopify notes that its days-remaining calculation uses recent average daily sales and that a variant with no sales in the period returns `N/A`, because there is not enough information to predict. That is a useful restraint to copy: when history is thin, widen the range instead of manufacturing precision.

## Adjust for named events, not optimism

Write down every adjustment and its evidence. Common adjustments include:

- a scheduled promotion with a comparable past campaign
- a known seasonal period with last year's SKU or category history
- a price change that affects demand or channel mix
- a planned stockist, creator, or email launch with a measured audience
- a discontinued substitute that may shift demand to this SKU
- a supplier, marketplace, or shipping constraint that limits sellable days

Use the closest comparable event you have. If last year's promotion raised weekly demand from 12 to 18 units for two weeks, the measured multiplier was 1.5 for that event. Do not apply it to the entire six-week horizon.

Search interest can help identify direction, not unit volume. The [Google Trends workflow](/blog/google-trends-seo-for-shopify-stores) is useful for checking whether category interest is rising, flat, or unusually spiky. It does not tell you that your store will sell a specific number of units.

## Produce three scenarios

A range is more useful than a single confident-looking number. Build:

- **Low:** normal demand with weaker response or a delayed event
- **Base:** the most defensible plan from comparable history
- **High:** stronger demand that is plausible and operationally important

For the hypothetical 12-unit-per-week SKU over six weeks:

| Scenario | Assumption | Six-week demand |
|---|---|---:|
| Low | 10 units per week | 60 |
| Base | 12 units per week | 72 |
| High | 15 units per week | 90 |

These are planning assumptions, not industry benchmarks. The point is to see the consequence. If buying for 90 units would trap cash and buying for 60 would create a likely stockout, you now know which supplier terms, reorder timing, or campaign plan needs work.

## Turn demand into a buying decision

Do not send the forecast quantity directly to a supplier. Calculate the inventory position first:

> Planned purchase = forecast demand + target ending stock − available stock − reliable incoming stock

Suppose the base demand is 72 units, you want 18 units left at the end, 24 are available, and 12 confirmed units will arrive before the period:

> 72 + 18 − 24 − 12 = 54 units

Then apply reality:

- supplier minimum and case pack
- actual lead-time range, not the best quote
- incoming shipment confidence
- expiry, storage, and obsolescence risk
- landed cost and cash due dates
- whether a smaller follow-up order is possible

Shopify's [purchase-order documentation](https://help.shopify.com/en/manual/products/inventory/purchase-orders) describes purchase orders as records of supplier, product, quantity, cost, and payment terms, with linked incoming inventory after confirmation. Keep the forecast version and the confirmed purchase order separate so an optimistic plan never appears as guaranteed incoming stock.

Before committing cash, run the order through [true profit per order](/blog/true-profit-per-order-not-just-revenue). More available inventory is not helpful if the landed margin cannot support the sale.

## Handle new and low-volume products differently

A new SKU has no trustworthy sales history. Use a capped test, not a statistical forecast:

1. estimate demand from the closest existing product or category
2. collect waitlist, preorder, survey, or customer-request evidence
3. set the maximum cash you can risk
4. place the smallest viable test order
5. define the date and evidence required for a reorder

For an established low-volume SKU, weekly sales may jump between zero and three units. Do not overreact to each week. Use a longer window, plan in ranges, and review whether the item is strategic, complementary, or simply tying up cash.

## Run a 30-minute weekly forecast review

Keep one row per important SKU with:

- available, committed, and reliable incoming units
- in-stock sales rate and comparison window
- low, base, and high demand
- named event adjustments
- actual supplier lead time
- next stockout date under the base case
- purchase decision, owner, and review date

Each week, replace the oldest period with the newest complete one, compare forecast with actual sales, and record why the miss happened. Was demand different, or was the product unavailable? Did a promotion overperform, or did a tracking definition change? Adjust the method only when the evidence repeats.

The goal is not to predict every order. It is to make stock, cash, and campaign decisions early enough that you still have options. Start today with the ten SKUs that contribute the most revenue or create the most stock risk, build three six-week scenarios, and review them at the same time next week.
