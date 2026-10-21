---
title: Shopify Inventory States Explained: On Hand, Available, and More
description: Understand Shopify inventory states—on hand, available, committed, unavailable, and incoming—so stock, purchasing, and fulfillment decisions stay accurate.
slug: shopify-inventory-states-explained
date: 2026-10-21
---

Shopify inventory numbers answer different questions. **On hand** tells you what is physically at a location. **Available** tells you what can still be sold. **Committed** is already set aside for orders or another supported commitment. **Unavailable** is physically present but intentionally not sellable. **Incoming** is moving toward the location but has not been received.

The mistake is treating those numbers as interchangeable. A store can have 50 units on hand and only 12 available. It can have 100 incoming and nothing ready to ship today. Use the state that matches the decision instead of reaching for the largest number on the screen.

## The five states at a glance

Shopify's current [inventory states documentation](https://help.shopify.com/en/manual/inventory-and-locations/fundamentals/inventory-states) defines five quantities for each variant at each location:

| State | What it means | Use it to answer |
|---|---|---|
| On hand | All units physically at the location | “How many units are here?” |
| Available | On-hand units still available to sell | “How many more can customers buy?” |
| Committed | Units set aside for unfulfilled orders, reserved draft orders, or transfers ready to ship | “How much stock is already promised?” |
| Unavailable | On-hand units held from sale, such as damaged, quality-control, safety-stock, or app-held units | “What is here but not sellable?” |
| Incoming | Units moving toward the location through transfers, purchase orders, or apps | “What should arrive later?” |

At a location, the core relationship is:

> On hand = Available + Committed + Unavailable

Incoming sits outside that equation until it is received. This is why adding incoming stock to on hand before receipt double-counts it.

## On hand is a physical total, not a promise to customers

On hand is useful for a shelf count, insurance review, storage decision, or inventory-value check. It includes sellable units plus units already committed or held as unavailable.

Suppose a variant has:

- 24 available
- 9 committed
- 7 unavailable

The location has 40 on hand. Only 24 are open for another sale. If a purchasing sheet uses 40 as the sellable balance, it overstates stock by 16 units.

Use on hand when reconciling the system to what is physically present. The [cycle-count workflow](/blog/shopify-inventory-cycle-counts) shows how to count, investigate variance, and approve corrections without hiding the cause.

Shopify says that editing on hand changes available by the same amount. That behavior makes sense when a physical count finds extra or missing stock, but it is the wrong tool for merely changing why known units cannot be sold. Move units between available and an unavailable state instead.

## Available is the number for new demand

Available is the quantity Shopify can still offer for sale at that location. It excludes committed, unavailable, and incoming units.

Use available for:

- checking whether a location can take another order
- estimating near-term stockout risk
- calculating a replenishment or transfer need
- deciding whether a promotion has enough sellable depth
- reviewing what the storefront can offer across eligible locations

Available is still not a forecast. Twenty available units might cover a month for one SKU and two hours for another. Pair the quantity with sales velocity, lead time, and safety stock through the [inventory planning routine](/blog/inventory-planning-solo-store-owners).

If available is negative, do not automatically add stock to make the warning disappear. Check whether the variant is allowed to sell out of stock, whether orders were routed to the wrong location, whether a transfer is incomplete, and whether a count or app changed the quantity.

## Committed means the unit already has a job

Committed inventory is on hand but set aside. Shopify includes units in unfulfilled orders, units reserved in draft orders, and units in a transfer marked ready to ship among the examples.

A high committed number is not automatically a problem. It can reflect a normal order backlog. The operational question is whether the work behind those commitments is moving.

Review committed units when:

- orders remain unfulfilled past the handling target
- draft-order reservations are no longer needed
- a transfer is marked ready to ship but the carton has not moved
- canceled or edited orders appear to leave stock tied up
- a location shows on-hand stock but little available inventory

Do not release a commitment just to make stock available for a second customer. Resolve the order, reservation, or transfer that created it. The [order fulfillment checklist](/blog/shopify-order-fulfillment-checklist) helps separate a real backlog from inventory that is merely stuck in the wrong operational state.

## Unavailable should explain a real hold

Unavailable stock is physically at the location but cannot be sold. Shopify's current [quantity-adjustment guidance](https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/adjusting-inventory-quantities) documents unavailable categories including damaged, quality control, safety stock, and other.

Use those states deliberately:

- **Damaged:** not sellable in its current condition
- **Quality control:** waiting for inspection or another release decision
- **Safety stock:** deliberately protected from normal sales
- **Other:** a defined hold that does not fit the named categories

“Other” should not become a warehouse attic. Add an owner, reason, and review date outside Shopify if the state itself cannot carry enough context. Every held unit should have a release, repair, claim, disposal, or other approved next step.

Moving a unit from available to unavailable changes its purpose without changing the physical on-hand total. That is more accurate than subtracting the unit from inventory and trying to remember where it went.

## Incoming is evidence of movement, not usable stock

Incoming tells you that inventory is expected at a location through a transfer, purchase order, or app. It does not mean the units passed inspection, reached the building, or can be promised to a customer.

Use incoming in forward planning only after checking:

- the source record and exact variant
- quantity still outstanding
- shipment or production status
- expected arrival date
- confidence that the units will be sellable
- whether the quantity is already counted elsewhere in the plan

When a transfer or purchase order is received, accepted units can become available and join on hand. Missing, damaged, rejected, or canceled units need their own outcome. The [inventory transfer workflow](/blog/shopify-inventory-transfer-workflow) explains why receiving the expected quantity without a physical count creates phantom stock.

## Use the right quantity for each calculation

Different decisions need different inputs:

### Can I accept another order?

Start with available at the locations eligible to fulfill that product. Do not use on hand or incoming as a substitute.

### What should I reorder?

Start with available, add only reliable incoming that will arrive inside the planning window, then compare that inventory position with expected demand and safety stock. Keep committed demand separate unless the chosen available number already reflects it.

### What should be on the shelf?

Use on hand, then reconcile its available, committed, and unavailable components. Incoming should not appear in the physical count.

### How much can move to another location?

Use origin available, then subtract the origin's near-term demand and protected buffer. Do not transfer units merely because they appear in on hand.

### What inventory is being held up?

Review committed and unavailable by age and reason. A rising total can expose stalled orders, forgotten reservations, damaged stock, or an app holding more units than intended.

## Work through a complete example

Imagine a fictional variant at one warehouse:

- 38 available
- 12 committed to unfulfilled orders
- 5 in quality control
- 3 held as safety stock
- 60 incoming on a supplier transfer

Unavailable is 8, so:

> On hand = 38 + 12 + 8 = 58

The warehouse physically holds 58 units, but only 38 can take new orders. The 60 incoming units remain separate.

If quality control releases four units, available becomes 42, unavailable becomes 4, and on hand remains 58. If ten incoming units are then accepted at receipt, incoming falls to 50, available rises to 52, and on hand rises to 68. No inventory was created by changing a label; the numbers followed the physical events.

## Audit inventory states weekly

Use a short exception review rather than scanning every healthy SKU:

1. Find negative available quantities and identify the order, setting, or adjustment behind them.
2. Sort committed quantities by oldest unfulfilled order or reservation.
3. Review unavailable stock by reason, value, owner, and age.
4. Open material incoming quantities and verify the source and expected date.
5. Compare on hand with recent counts and adjustment history.
6. Check locations where on hand exists but available shows a dash; Shopify's [inventory view guidance](https://help.shopify.com/en/manual/inventory-and-locations/adjusting-inventory/viewing-inventory) says this can indicate that the variant is inactive for fulfillment at that location.

Start with one high-volume variant and reconcile all five states to physical evidence. Once every unit has a clear state and next event, repeat the same check for the rest of the fast-moving catalog.
