---
title: Request an AI inventory watchlist, not automatic purchase orders
description: Define a restock-review outcome using variant-level stock, sales and lead-time assumptions, with evidence and explicit limits on purchasing authority.
slug: ai-inventory-reorder-watchlist
date: 2026-10-28
---
An inventory agent does not need permission to buy stock to deliver something useful. A short weekly watchlist can show which variants deserve a restock decision, what the estimate depends on and which missing facts prevent a confident recommendation.

The outcome is a review queue, not a forecast presented as certainty. Start with a small range of products, read-only inputs and a buyer-approved decision rule.

## Define stock before doing the arithmetic

Available, committed, damaged and incoming units are not interchangeable. A warehouse can physically hold an item that cannot be sold to the next customer. Record the inventory state and location used for the calculation.

Shopify's current [inventory-report documentation](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/inventory-reports) notes a reporting change to on-hand quantities from October 1, 2026. Do not mix historical available quantities with newer on-hand quantities without understanding the difference. For a sellable-stock watchlist, request the appropriate available-stock source rather than assuming a report's ending quantity means immediately purchasable inventory.

## Make assumptions visible

Request variant ID, location, available units, recent unit sales, confirmed incoming stock and supplier lead time. Record the source timestamp for each. A blank lead time means unknown, not zero days.

A hypothetical variant has 42 available units and averaged three units sold per day during a chosen period. That suggests 14 days of stock at the same sales pace. If replenishment takes 21 days, it deserves review. It does not prove the next two weeks will follow the historical average.

Promotion periods, recent stockouts and new launches can make a simple average misleading. Flag those conditions and explain which comparison period was used. Keep an item with no sales history in an insufficient-data category instead of assigning an impressive-looking forecast.

## Request a prioritized output

A useful row contains the variant, location, available stock, recent sales pace, estimated cover, lead-time assumption, evidence reference and reason for review. Separate confirmed purchase orders from merely suggested replenishment. Do not count the same inbound shipment twice.

Limit the report to an agreed number of priorities and include an exceptions section. A buyer should be able to identify the next decision quickly, while still tracing the underlying arithmetic.

## Test the watchlist before making it recurring

Use a small acceptance set: one low-stock variant, one healthy variant, one with zero recent sales, one with incoming stock and one with missing lead time. Independently recompute the numbers. Check that a stale input is labeled stale and that no supplier contact or order was triggered.

Require a fresh snapshot and a run timestamp on every report. If access fails, the agent should report a blocked run rather than recycle last week's numbers as current. A reliable watchlist can reduce preparation work while leaving purchasing authority where it belongs. If the pilot becomes recurring, add a [handover note](/guides/recurring-ai-agent-handover) covering the schedule, owner, limits and failure handling.
