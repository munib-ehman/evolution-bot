---
title: Shopify Inventory Transfer Workflow Between Locations
description: Move Shopify inventory between locations without losing stock. Plan, ship, receive, and reconcile transfers with clear states, counts, and exception handling.
slug: shopify-inventory-transfer-workflow
date: 2026-10-19
---

A Shopify inventory transfer should explain where stock came from, where it is going, what physically moved, and what the destination accepted. A manual quantity change at each location can make the totals look right, but it erases the movement trail and makes shortages hard to investigate.

Use one transfer record from request through receipt. Reserve the right units, pack and count the shipment, move it to the correct transfer state, receive only what arrived, and reconcile every rejected or missing unit. The transfer is finished when the physical stock and both location records agree.

## Use a transfer when stock changes custody

Create a transfer when inventory moves between store locations or between a tracked location and an external source or destination that the transfer workflow supports. Common cases include:

- warehouse to retail store replenishment
- one retail location balancing another
- supplier shipment arriving into a warehouse
- stock moving to or from an external location
- split shipments against one planned movement

Shopify's current [inventory-transfer documentation](https://help.shopify.com/en/manual/inventory-and-locations/inventory-transfers/creating-and-processing-transfers) says transfers can move and track inventory between store locations and to or from external locations such as suppliers. It also allows an origin or destination to be left blank for supported external movements.

Do not use a transfer to disguise an unexplained count difference. If units did not physically change custody, investigate and record the correct inventory adjustment reason. Use the [cycle-count workflow](/blog/shopify-inventory-cycle-counts) to resolve shelf-versus-system discrepancies.

## Decide the quantity before creating the record

For a location replenishment, calculate the proposed movement by SKU:

> Transfer quantity = destination target − destination available − reliable incoming

Then limit it by what the origin can safely release:

> Transferable quantity = origin available − origin safety stock − near-term origin demand

Suppose a shop wants 18 units of a variant, has 4 available and 2 reliably incoming, so it needs 12. The warehouse has 30 available but needs 20 for its own near-term demand and safety stock. Only 10 are safely transferable. Move 10 and record the remaining need instead of creating a 12-unit promise that damages the origin.

Use the [inventory planning routine](/blog/inventory-planning-solo-store-owners) to set destination targets and origin buffers. A transfer can solve a location imbalance; it cannot create stock that the network does not have.

## Understand what each transfer state means

Shopify's current workflow uses states that change how inventory is represented:

| State | Operational meaning |
|---|---|
| Draft | Movement is planned; inventory is not yet committed |
| Ready to ship | Origin units are committed for the transfer |
| In progress | Shipment is moving; units are incoming at the destination |
| Transferred | Units have been received and made available at the destination as configured |
| Canceled | Committed units are released back to available at the origin |

Do not mark a transfer ready, in progress, or transferred merely to tidy the queue. Each status should follow physical evidence.

Shopify says a draft transfer can still have its origin, destination, products, quantities, and details edited. After a transfer is processed, origin and destination cannot be changed. Confirm those two locations before committing stock.

## Create a transfer another person can execute

Use one row per exact variant and include:

- origin and destination
- SKU, variant, and quantity
- reference name tied to the business request
- requester and approver
- expected ship and arrival dates
- carrier or internal route
- handling notes for fragile, lot-controlled, or high-value units
- reason: replenishment, balancing, supplier receipt, event stock, or return to source

Shopify supports notes, tags, reference names, tracking, expected arrival, shipment barcodes, and shipment cost adjustments in the transfer workflow. Use only the fields that improve execution and review; do not bury the quantity decision in a vague note.

For a supplier purchase, keep the commercial agreement in the purchase order and the physical movement in the linked transfer. The [purchase-order workflow](/blog/ecommerce-purchase-order-workflow) explains why “ordered” and “received” must remain separate.

## Commit only units you can find and ship

Before marking stock ready to ship:

1. Pick by SKU and source location.
2. Verify variant, quantity, and sellable condition.
3. Separate units by transfer and shipment.
4. Record lot, serial, or expiry data where the business requires it.
5. Count again at packing.
6. Compare the packed quantity with the transfer.

Marking a transfer ready to ship commits the units at the origin. If the stock cannot be located, correct the transfer and investigate the origin quantity before changing status. Do not leave committed phantom stock while searching for it.

For multiple cartons or departure dates, use separate shipment records where supported. One transfer can describe the overall movement while shipment details explain which units are actually on each route.

## Move to in transit at physical handoff

Use **Move to in transit** when the shipment has actually left the origin or entered the controlled movement process. Add tracking, carrier, expected arrival, and shipment cost information when those details exist.

Do not treat “label printed” as “in transit.” A carton under the packing table is still at the origin. Record carrier acceptance, internal driver handoff, or another defined custody event.

At this stage, the destination should plan around **incoming**, not available, stock. Shopify's current inventory report documentation says incoming transfer units are excluded from on-hand inventory. Do not sell or promise those units as if they were already received unless the store deliberately allows that through a separate policy.

## Receive what arrived, not what the transfer expected

The destination should count before using the units. Compare:

- transfer and shipment reference
- carton or seal condition
- SKU and variant
- quantity expected and observed
- sellable condition
- destination location and bin

Shopify's current [transfer-receiving guidance](https://help.shopify.com/en/manual/inventory-and-locations/inventory-transfers/receiving-and-managing-transfers) provides three actions:

- **Accept:** makes the quantity available at the destination when the product is stocked there or activated during receipt.
- **Reject:** records the quantity on the transfer without changing inventory at either location.
- **Cancel:** records units that were never shipped; for a transfer between two locations, those units become available again at the origin.

These outcomes are not interchangeable. Reject a unit that arrived but cannot be accepted. Cancel a unit that never left. Accept only units that are physically present and sellable under the destination's rules.

For example, a transfer expects 20 units. The destination receives 18 sellable units and 1 damaged unit; the origin confirms 1 unit never shipped. Record 18 accepted, 1 rejected, and 1 canceled. Accepting all 20 and fixing quantities later would erase the story of the shortage and damage.

## Keep partial receipts open and owned

Shopify keeps a transfer in progress when only some items are received. That is useful, but only if the remainder has an owner.

For every partial receipt, record:

- quantity still expected
- latest custody or tracking evidence
- next expected date
- person investigating
- decision deadline for accepting, rejecting, or canceling the balance

Review open transfers at least weekly. Old incoming quantities can make replenishment decisions look safer than they are. The dashboard should separate on-time movement from late, damaged, missing, and canceled units.

## Reconcile origin, transit, and destination

At closure, prove this equation for each SKU:

> Quantity released by origin = quantity accepted + quantity rejected + quantity canceled or otherwise resolved

Then verify:

- origin committed units cleared correctly
- destination accepted units are available in the intended location
- rejected units are physically quarantined with an owner
- canceled units are physically and digitally back at the origin when applicable
- every shipment has a final status
- tracking, notes, and costs are attached to the right record
- no manual adjustment duplicated the transfer movement

Run a destination count after material discrepancies. If the same route repeatedly produces missing units, review picking, carton labeling, carrier custody, and receiving cutoffs rather than treating every variance as random.

## Measure transfer reliability

Track a few operational measures:

> Fill rate = units shipped / units requested

> Acceptance rate = sellable units accepted / units received

> On-time rate = transfers received by expected date / transfers due

Also track count variance, damage, late days, canceled units, and manual corrections after receipt. Segment by origin, destination, route, and operator only when the volume makes the comparison useful.

Transfer metrics should change a decision. Low fill rate can require better origin buffers. Repeated rejection can require packaging or handling changes. Long late periods can require larger destination safety stock or a different route.

## Use a one-page transfer checklist

- [ ] Business reason, origin, and destination confirmed
- [ ] Quantity calculated by SKU and approved
- [ ] Draft includes exact variants, reference, and expected dates
- [ ] Physical units picked and counted before commitment
- [ ] Ready-to-ship state matches reserved stock
- [ ] In-transit state matches actual handoff
- [ ] Tracking and shipment details recorded
- [ ] Destination counted before accepting
- [ ] Accepted, rejected, and canceled quantities used correctly
- [ ] Partial balance has an owner and review date
- [ ] Origin and destination quantities reconciled
- [ ] Exceptions added to the next count or process review

Start with the oldest open transfer. Confirm where every remaining unit physically sits, then make the Shopify state tell the same story. Once that record is clean, apply the checklist to the next movement before it leaves the origin.
