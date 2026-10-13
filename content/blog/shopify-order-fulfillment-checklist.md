---
title: Shopify Order Fulfillment Checklist: Pick, Pack, and Ship
description: Build a Shopify fulfillment checklist for payment review, picking, packing, labels, tracking, carrier handoff, and order exceptions without missed steps.
slug: shopify-order-fulfillment-checklist
date: 2026-10-13
---

A reliable Shopify order fulfillment process has one job: send the correct sellable items to the correct customer, with a truthful shipment record and enough evidence to resolve an exception.

The safest sequence is review, release, pick, verify, pack, label, hand off, and reconcile. Do not let buying a label or clicking “fulfilled” stand in for the physical work. Shopify can record the order state, but your checklist must keep the screen, parcel, and carrier event aligned.

## Define when an order is ready to release

Start with a queue that separates ordinary orders from exceptions. Before an order reaches the picking area, verify:

- payment status matches the store's policy
- fraud or manual-review flags have an owner
- shipping address is complete enough for the selected carrier
- inventory is assigned to the correct fulfillment location
- customer edits, cancellation requests, and order notes are resolved
- preorder, subscription, pickup, digital, and backordered items follow the right path
- promised handling time is still achievable

Put unclear orders on hold instead of relying on a sticky note. Shopify's current [fulfillment guidance](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders) supports self-fulfillment, fulfillment services, or a mix, and Shopify documents a distinct on-hold state for work that should not proceed.

Create exception reasons that lead to actions: address review, payment review, inventory mismatch, customer change, preorder date, split shipment, or compliance check. “Problem order” is not a useful queue.

## Pick from a controlled list

Use a packing slip or pick list that identifies the exact variant, SKU, quantity, and fulfillment location. Shopify's [packing-slip documentation](https://help.shopify.com/en/manual/fulfillment/managing-orders/printing-orders/packing-slips) says slips can include items, addresses, SKUs, quantities, and other product details, and can be printed individually or in bulk.

Pick in a consistent physical route:

1. Start one tote or clearly separated area per order.
2. Match the storage label to the SKU, not only the product photo.
3. Confirm variant attributes such as size, color, pack count, and voltage.
4. Count units into the tote.
5. Mark shortages or damaged stock immediately; do not substitute silently.
6. Move completed picks to a separate verification zone.

For batch picking, preserve order identity throughout the batch. Saving walking time is not useful if two similar variants switch parcels. High-value, serialized, regulated, or gift orders may deserve single-order handling even when ordinary orders are batched.

## Verify before sealing the parcel

The packer should compare the physical items with the order again. If one person runs the whole operation, change the method: pick by location, then verify at a separate bench by order and SKU.

Check:

- item and variant
- quantity
- condition and product seal
- required insert, accessory, or gift message
- customer and destination
- chosen package
- any restriction on carrier or service

Record serial, lot, or batch information where the product and applicable process require it. Keep return instructions and marketing inserts from covering the operational information the customer needs.

Use packaging that protects the contents without creating avoidable dimensional weight. The [shipping-rate guide](/blog/shopify-shipping-rates-free-flat-calculated) explains why package weight, dimensions, service, and destination can materially change the store's cost.

## Buy the label from the packed parcel

The label should describe the parcel you actually built. Verify:

- ship-from and ship-to addresses
- package type, weight, and dimensions
- carrier and service level
- declared or insured value where appropriate
- signature or other delivery options
- customs description and documentation for international shipments
- order number and tracking association

Shopify's [shipping-label overview](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/shipping-labels/understanding-shipping-labels) explains that labels identify the sender, recipient, service, and tracking barcode. Availability, carriers, and label features vary by region and setup.

After printing, match the label to the order before attaching it. Cover or remove every old carrier barcode on reused packaging. Scan the label back to the open order where the workflow supports it, then move the parcel into the correct carrier's handoff area.

## Keep “fulfilled” and “with the carrier” distinct

Shopify's current instructions for [fulfilling an order individually](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment) say that buying a Shopify shipping label can mark the order fulfilled and that a tracking number can be included in the shipping confirmation. Operationally, a printed label is not proof that the carrier has the parcel.

Define these states separately in the SOP:

| State | Evidence |
|---|---|
| Packed | Final item check and sealed parcel |
| Label created | Label attached and tracking tied to order |
| Ready for handoff | Parcel sorted into the correct carrier area |
| Handed off | Pickup scan, acceptance scan, manifest, or drop-off receipt |
| In transit | Carrier movement event |

If the platform sends a shipping notification at label creation, make the wording accurate. The [order and shipping email guide](/blog/order-shipping-update-emails-customers-read) shows how to distinguish “tracking is ready” from “the carrier accepted your parcel.”

Close each day by comparing labels created with parcels physically handed off. A box left under the bench should not look like a moving shipment in the customer record.

## Handle split and partial fulfillments deliberately

Shopify can create separate fulfillments when items ship from different locations or cannot ship together. A store can also fulfill only part of an order. Each shipment needs the correct quantities, tracking number, and customer notification.

For a partial shipment:

1. confirm the customer promise and cost of splitting
2. select only the units physically in this parcel
3. attach this parcel's tracking to this fulfillment
4. state which items shipped and which remain pending
5. assign an owner and date to the remaining items

Do not mark the full order fulfilled to clear the queue. It hides the outstanding work and can tell the customer that an item shipped when it did not.

Never substitute a materially different item without the customer's agreement. For US sales within its scope, the FTC's [Mail, Internet, or Telephone Order Merchandise Rule guide](https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule) says sellers need a reasonable basis for shipment promises and describes delay-consent and refund duties when a promised shipment cannot be made. Apply the legal process relevant to the sale and jurisdiction; a fulfillment checklist is not a substitute for legal review.

## Build exception paths before you need them

Write one response for each common failure:

### Inventory mismatch

Pause the order, recount the SKU, check other locations and open transfers, and correct the root cause. Offer a truthful choice only after availability is known.

### Damaged item during packing

Move it out of sellable stock, document the reason, and repick. Do not return it to the shelf after the label is purchased.

### Address or label error

Void or correct the label through the supported process before carrier acceptance. Do not hand-edit a carrier barcode label.

### Missed carrier handoff

Keep the parcel secure, update the next realistic handoff, and contact affected customers before they have to ask. Use the [WISMO reduction workflow](/blog/wismo-cut-support-tickets-in-half) to make status visible and handle stalled shipments proactively.

### Customer cancellation after packing

Stop the parcel if it has not transferred to the carrier, follow the store's cancellation policy, and return the units through a controlled restock step. If the carrier already controls it, do not promise an intercept until the carrier confirms one.

## Measure errors per order, not just orders per hour

Speed matters only after accuracy. Track:

- orders released, packed, and handed off
- same-day backlog at the cutoff
- wrong item or quantity incidents
- parcels without an acceptance event
- label voids and address corrections
- damage attributed to packing
- split shipments and their extra cost
- support contacts per shipped order

Review every reshipment. Its visible cost is product and postage; its wider cost can include support time, lost margin, and customer trust. Categorize the cause as release, pick, pack, label, handoff, carrier, or catalog data so the corrective action lands in the right step.

## The one-page fulfillment checklist

Use this for every ordinary shipment:

- [ ] Payment and exception review complete
- [ ] Correct location and fulfillment selected
- [ ] SKU, variant, and quantity picked
- [ ] Item condition and accessories verified
- [ ] Customer, address, and order matched at packing
- [ ] Parcel weighed and measured after packing
- [ ] Carrier, service, and label details checked
- [ ] Tracking attached to the correct fulfillment
- [ ] Customer notification matches the actual state
- [ ] Parcel sorted to the correct carrier
- [ ] Carrier handoff evidence reconciled
- [ ] Remaining items or exceptions assigned

Run five ordinary orders through the checklist and note where the operator has to guess. Fix those ambiguous points first. A useful SOP is not the longest document; it is the shortest sequence that reliably keeps the parcel and the order record telling the same story.
