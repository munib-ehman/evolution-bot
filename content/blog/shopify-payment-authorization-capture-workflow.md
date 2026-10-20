---
title: Shopify Payment Authorization and Capture Workflow
description: Choose automatic or manual Shopify payment capture, monitor authorization deadlines, review fraud risk, and release orders without shipping unpaid orders.
slug: shopify-payment-authorization-capture-workflow
date: 2026-10-20
---

Payment authorization and payment capture are two different events. Authorization asks the customer's payment provider to reserve capacity for the purchase. Capture submits the charge for processing so the store can receive the money.

For most small stores, automatic capture at checkout is the safest default because it removes a deadline from the fulfillment process. Manual capture is useful when a real review must happen before charging: confirming scarce inventory, approving a custom order, or checking fraud risk. It is not useful when nobody owns the queue.

The operating rule is simple: never treat **Authorized** as **Paid**, and never ship an order whose payment state your policy does not allow.

## Choose a capture method for an operational reason

Shopify's current [payment authorization documentation](https://help.shopify.com/en/manual/payments/payment-authorization) describes automatic capture at checkout, automatic capture when the entire order is fulfilled, and manual capture. Automatic capture per fulfillment is also available on Shopify Plus, subject to provider and order limitations.

Use the method that matches how the store actually releases orders:

| Capture method | Good fit | Main operational risk |
|---|---|---|
| Automatically at checkout | Ordinary stocked products with quick fulfillment | Charging before an inventory or fraud exception is found |
| Automatically when the entire order is fulfilled | Orders that reliably fulfill as one complete order within the authorization window | Partial fulfillment can leave the whole payment uncaptured |
| Manually | Custom, high-risk, or inventory-sensitive orders with a staffed review queue | Missing the authorization deadline or shipping before capture |
| Per fulfillment on Shopify Plus | Stores intentionally capturing line items as separate fulfillments | Provider limitations, discount allocation, and exception handling |

Do not pick manual capture because it sounds more controlled. It creates control only when every authorized order has an owner, a due time, and a release checklist. Otherwise it creates an invisible accounts-receivable problem inside the Orders page.

Also inspect connected payment and fulfillment apps before changing the store setting. Shopify warns that combining its automatic capture with a third-party app that also captures payments can create conflicts or unexpected behavior.

## Understand the authorization clock

An authorization is temporary. The length depends on the provider and payment method. Shopify's documentation says Shopify Payments provides a standard seven-day authorization period, while some Shopify Plus transactions can qualify for extended periods.

Use the expiration shown on the order as the working deadline. Do not calculate it from memory or assume every card and provider behaves the same way.

For each authorized order, record:

- order number and amount authorized
- exact authorization-expiry date and time shown in Shopify
- reason capture is delayed
- reviewer and next action
- inventory and fulfillment state
- latest safe capture time under the store's policy

Set Shopify's warning email when it is available, but do not make one inbox message the control. Build a saved order view for authorized payments and review it at least once each business day. During weekends, launches, or holidays, name the person covering the queue.

If the authorization expires, the right response depends on the provider and the order. Do not ship and hope the payment can be recovered later. Hold fulfillment, confirm the payment path Shopify offers, and contact the customer if a new transaction is required.

## Separate risk review from payment collection

Manual capture can give you time to review an order, but it does not make a risky order safe. Start with the order's actual signals:

- Shopify fraud analysis and indicators
- AVS, CVV, and 3D Secure information when present
- shipping and billing relationship
- customer and order history
- quantity, value, reship risk, and product resale value
- unusual velocity or repeated attempts
- customer communication and address confirmation

Use a short decision tree:

1. **Ordinary risk and inventory confirmed:** capture and release.
2. **Information missing but resolvable:** keep on hold, assign the check, and set a deadline before authorization expiry.
3. **Material fraud evidence:** cancel using the supported process; do not capture merely to make the order look complete.
4. **Inventory unavailable or promise cannot be met:** cancel or agree on a supported alternative before capture.

The broader [Shopify fraud-review guide](/blog/ai-fraud-detection-for-shopify-stores) covers signals and false positives. Keep the decision factual. A foreign address, gift destination, or first order is not proof of fraud by itself.

## Confirm inventory before a delayed capture

If inventory uncertainty is the reason for manual capture, define what “confirmed” means. A positive Available number is not enough when the unit is damaged, assigned to another location, reserved for another channel, or physically missing.

Before capture, verify:

- the exact SKU and quantity exist at the fulfillment location
- the units are sellable rather than damaged or quarantined
- an open transfer or stock count will not change the answer
- the fulfillment team can meet the customer promise
- the item has not been oversold through another channel

For recurring discrepancies, fix the source with the [inventory cycle-count process](/blog/shopify-inventory-cycle-counts). Manual capture should not become a permanent workaround for unreliable stock records.

## Capture before releasing the physical order

Shopify's [order-payment guidance](https://help.shopify.com/en/manual/fulfillment/managing-orders/payments) distinguishes authorized, pending, and paid states and notes that some methods or channels process outside Shopify. Build the release gate around the actual method.

For an ordinary manual-capture order:

1. Complete fraud, inventory, and customer checks.
2. Confirm the final order total and currency.
3. Capture through the supported order action.
4. Refresh the order and verify the payment status and transaction record.
5. Remove the payment hold.
6. Release the order to picking or the fulfillment partner.

Do not reverse steps four and five. A button click is not evidence that the provider completed the transaction. The [fulfillment checklist](/blog/shopify-order-fulfillment-checklist) should start only after the payment gate is satisfied.

If an app requires a paid order before it can accept a fulfillment request, test the complete sequence before selecting automatic capture at fulfillment. Shopify specifically notes compatibility limits for some capture methods and fulfillment apps.

## Handle partial fulfillment without assuming partial capture

Partial shipping creates one of the easiest payment mistakes. On standard automatic capture at fulfillment, Shopify says the entire order must be fulfilled before capture; partially fulfilled orders are not captured under that setting.

Before splitting an order, answer:

- Will this provider and plan capture anything on the first fulfillment?
- Is the full authorization still valid through the final shipment?
- Should the whole amount be captured before the first parcel leaves?
- Has the customer agreed to the revised shipment plan?
- Who owns the remaining authorized balance and item?

Do not infer payment behavior from the fulfillment screen. Run a test order for the exact provider, capture setting, and split pattern you intend to use.

## Watch foreign-currency exposure and customer confusion

Shopify notes that a foreign-currency payment captured later is converted using the exchange rate at capture, not necessarily the rate at authorization. The authorized amount is also the maximum available to capture. If the order changes, confirm that the amount and currency path still work before promising a result.

Customers can also see a temporary authorization hold on their bank statement. That hold is not necessarily a duplicate charge. Give support a plain explanation and require the order record before answering. Never promise the exact date a bank will remove a hold; issuer timing varies.

For order changes, follow the [safe order-editing workflow](/blog/shopify-order-editing-workflow). An edit can affect the total, payment requirement, fraud indicators, currency result, and downstream fulfillment record.

## Reconcile the queue every day

Use a simple daily table:

| Order | Payment state | Authorization expires | Hold reason | Owner | Next action |
|---|---|---|---|---|---|
| #1048 | Authorized | Oct 22, 3:10 p.m. | Inventory check | Mina | Confirm location count by noon |

The row above is fictional. Its value is the structure: deadline, reason, owner, and action in one place.

At close, reconcile:

- authorized orders without a decision
- orders approaching expiration
- captured orders still on payment hold
- fulfilled orders that are not paid
- canceled orders with lingering fulfillment work
- capture failures or amounts that differ from expectation

Escalate any fulfilled-but-unpaid order immediately. Confirm whether a transaction exists, stop later parcels, preserve the order timeline, and use the provider's supported recovery process. Do not create an undocumented duplicate charge.

## Test before changing the store-wide setting

Run at least these cases in a safe test environment or with an approved test-order method:

- ordinary capture and fulfillment
- authorization held for review, then captured
- cancellation before capture
- full fulfillment under automatic-at-fulfillment
- partial fulfillment
- order edit that changes the total
- capture failure or expired authorization path
- a connected fulfillment or payment app

Write the expected payment and fulfillment states for every step. If the team cannot tell Authorized from Paid at a glance, fix that training gap before enabling manual capture.

Start with the current authorized-order queue. Assign every row, record its displayed expiration, and resolve the oldest authorization first. That one review will show whether the store has a deliberate payment workflow or only a setting.
