---
title: Ecommerce Purchase Order Workflow: From Draft to Receiving
description: Build an ecommerce purchase order workflow that connects approved quantities, supplier terms, shipments, receiving, and actual landed cost without gaps.
slug: ecommerce-purchase-order-workflow
date: 2026-10-12
---

A useful ecommerce purchase order workflow separates three things that small teams often blur together: what you agreed to buy, what the supplier actually shipped, and what your location actually accepted.

The purchase order records the commercial agreement. Shipment records track movement. Receiving records decide what becomes available inventory. Keep those records connected, but do not let one status pretend the other two are complete.

## Start only after the buying decision is approved

A purchase order should document a decision, not make one by accident. Before drafting it, confirm:

- the supplier and payment recipient are approved
- the product specification and sample version are final
- each SKU quantity has an owner and a reason
- landed-margin and cash checks pass
- production, inspection, and handoff dates are realistic
- the destination location is ready to receive
- required compliance, labeling, and shipping documents are named

Use the [supplier sourcing checklist](/blog/sourcing-products-from-suppliers-checklist) for the due-diligence work. The PO is not a replacement for product compliance, a signed supply agreement, or legal review where those are needed.

## Calculate quantities before opening the PO

Use the purchasing equation from the inventory plan:

> Planned purchase = forecast demand + target ending stock − available stock − reliable incoming stock

Then apply supplier and cash constraints:

- minimum order quantity and case pack
- production and freight lead time
- confirmed open orders
- storage or expiry limits
- low, base, and high demand cases
- deposit and balance dates
- total landed contribution

The [demand forecasting guide](/blog/forecast-demand-small-ecommerce-store) explains how to build the scenarios. Keep its forecast separate from the order quantity so a buyer can see where judgment, minimums, or risk tolerance changed the number.

For example, suppose a fictional SKU has base-period demand of 180 units, a target ending stock of 40, 55 available, and 25 reliably incoming:

> 180 + 40 − 55 − 25 = 140 units

If the case pack is 24, the commercial choice might be 144 units. Record the reason for the extra four. Small adjustments become confusing later when nobody remembers whether they came from demand, packaging, or a supplier request.

## Draft the commercial record completely

Shopify's current [purchase-order documentation](https://help.shopify.com/en/manual/inventory-and-locations/purchase-orders/creating-purchase-orders) says a PO can record supplier, destination, products, quantities, prices, payment terms, currency, and cost summary. It can remain a draft while the supplier reviews it.

Include or attach enough detail to remove ambiguity:

- PO number, issue date, buyer, and supplier legal details
- destination and billing information
- variant and supplier SKU
- product specification and approved sample reference
- quantity, unit cost, tax treatment, and currency
- packaging, labeling, and carton requirements
- production and inspection milestones
- shipping term and named place where relevant
- payment terms and bank-detail verification process
- quality and acceptance criteria
- documents required before shipment
- treatment of shortages, defects, delay, and cancellation

Do not rely on a note that says “same as last time.” Reference the controlling file and version. Export the draft for supplier review and keep revisions identifiable.

## Reconcile the PO with cash before approval

Map each payment to the week it is expected to leave the bank:

- deposit
- sample, tooling, or testing fees
- production balance
- inspection
- freight and insurance
- duty and brokerage
- receiving or storage

The order can be profitable in a margin model and still create a cash shortfall between the deposit and customer receipts. Put the agreed dates into the [13-week cash flow forecast](/blog/ecommerce-13-week-cash-flow-forecast), including a lower-sales case.

Also compare the PO unit cost with the last order and approved quote. If cost changed, document whether the cause was material, quantity, currency, packaging, or an added service. A repeated “small” increase is easy to miss when the old number auto-fills.

## Mark it ordered only after supplier confirmation

Send the draft to the supplier and ask for explicit confirmation of line items, price, payment terms, specification, and milestones. Use the structures in the [supplier coordination email templates](/blog/supplier-coordination-email-templates) when an answer needs numbered decisions and evidence.

Shopify's documentation says to mark the PO as Ordered after the supplier confirms it, and that this status change cannot be reversed. Most details can still be edited, but edits should reflect agreed changes rather than quietly rewriting the original decision.

For every material change after confirmation:

1. record the request and reason
2. assess quantity, cost, timing, margin, and cash impact
3. get approval from both sides
4. update the PO and affected specification or schedule
5. preserve the earlier version or decision log
6. update the linked movement record where needed

The inbox is evidence of discussion. The current PO and its change log should state the agreement.

## Track physical movement separately

Shopify's current [purchase-order receiving guide](https://help.shopify.com/en/manual/inventory-and-locations/purchase-orders/creating-inventory-transfers) separates the commercial agreement from the physical movement. After a PO is marked Ordered, a linked inventory transfer can track shipments, receiving, and cost adjustments.

That separation matters. “Ordered” does not mean:

- production is complete
- the goods passed inspection
- a carrier accepted them
- customs cleared them
- the warehouse received them
- the units are sellable

Create the linked transfer, confirm its origin and destination, and add shipment-level tracking. When a supplier splits the order, track the shipments separately instead of moving the entire PO to an invented halfway status.

Use milestones such as:

| Milestone | Evidence |
|---|---|
| Supplier confirmed | Signed or written confirmation of current PO |
| Production complete | Quantity and inspection-ready evidence |
| Released | Inspection or approval record |
| Handed to carrier | Transport document and tracking reference |
| In transit | Current carrier event and expected arrival |
| Received | Count and condition record at destination |

## Receive what arrived, not what was expected

At receiving, count and inspect against the PO, packing list, and shipment. Shopify's guide supports three outcomes on the linked transfer:

- **Accepted:** units become available at the destination.
- **Rejected:** units are recorded but do not become available.
- **Canceled:** units that were never shipped are removed from the supplier transfer.

Use specific quantities. If 144 were expected, 138 are acceptable, four are damaged, and two never shipped, record those outcomes instead of accepting 144 and planning to fix inventory later.

Create a discrepancy record with:

- PO, shipment, SKU, lot, and quantity
- expected versus observed result
- photos, count sheets, or inspection evidence
- accepted, quarantined, rejected, and missing units
- owner and supplier response deadline
- credit, replacement, rework, or other approved resolution

Do not make questionable units available merely to clear the receiving task. For regulated or safety-sensitive products, follow the applicable hold, reporting, and expert-review process.

## Reconcile actual landed cost

Freight, duty, and other charges are often unknown when the PO is drafted. Shopify's linked-transfer guide allows shipment cost adjustments and a comparison between agreed product cost and actual receipt cost.

Calculate:

> Actual landed cost per sellable unit = total product and inbound costs / accepted sellable units

Use accepted sellable units in the denominator. If defects or shortages reduced the usable quantity, the surviving units carry more of the cost unless a supplier credit or claim recovers it.

Compare estimated and actual landed cost, then explain material variance. Feed the result into pricing, margin, and the next PO rather than leaving it in a freight invoice.

## Close the workflow with a supplier review

When every quantity and cost is accounted for:

1. confirm all accepted units are available in the correct location
2. confirm rejected, canceled, and missing units have a resolution
3. match supplier invoices and credits to the agreement
4. reconcile deposits, balances, freight, duty, and adjustments
5. record actual lead time and landed cost
6. archive the PO when it no longer needs active attention
7. update the supplier scorecard

Track at least on-time milestone performance, quantity accuracy, acceptance rate, response quality, and landed-cost variance. Use the result to change safety stock, payment terms, inspection depth, or supplier allocation on the next cycle.

## Run a weekly open-PO review

For every open order, show:

- PO and supplier
- cash committed and remaining
- next milestone and due date
- current shipment location
- expected receiving date
- quantity ordered, shipped, accepted, rejected, and outstanding
- latest landed-cost estimate
- blocker, owner, and next action

This review should connect to the [inventory planning routine](/blog/inventory-planning-solo-store-owners). An overdue PO is not merely a purchasing issue; it changes stockout risk, campaign plans, and cash timing.

Start with the highest-value open PO. Confirm that the agreement, shipment, and receiving records tell the same story. If they do not, reconcile that order before issuing the next one.
