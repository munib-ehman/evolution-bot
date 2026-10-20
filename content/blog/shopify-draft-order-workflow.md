---
title: Shopify Draft Order Workflow for Quotes and Invoices
description: Build Shopify draft orders safely: confirm products, pricing, inventory, tax, shipping, invoices, payment status, and fulfillment before releasing an order.
slug: shopify-draft-order-workflow
date: 2026-10-20
---

A Shopify draft order is a working sales record you create for a customer. It can support a phone order, negotiated quote, replacement, wholesale-style request, custom item, or invoice with a secure checkout link.

It is not a completed order, a guaranteed reservation, or proof of payment. A reliable workflow moves through five controlled states: request, priced draft, customer approval, payment, and fulfillment release.

Use draft orders when a normal storefront checkout cannot cleanly represent the agreed sale. Do not use them to bypass pricing, tax, inventory, payment, or validation rules you have not understood.

## Define the use case before building the draft

Write one reason on every draft:

- phone or email order
- custom product or service line
- replacement with a balance due
- negotiated bundle or quantity price
- B2B or other approved payment terms
- invoice for a customer who will pay through checkout
- recreated order after a supported cancellation or edit path

That reason determines the evidence and approvals you need. A simple phone order might require product, address, tax, shipping, and payment confirmation. A custom wholesale quote may also need an expiry date, customer approval, inventory reservation, payment terms, and an owner.

If the customer merely wants to change an existing unfulfilled order, first use the [order-editing decision process](/blog/shopify-order-editing-workflow). Duplicating the order into a draft can create a second sale, another inventory commitment, and a confusing refund unless the original is handled deliberately.

## Build from verified customer and product data

Shopify's current [draft-order overview](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders) says a draft can include products, discounts, shipping, taxes, a customer, tags, and a market. Build the record from the exact agreement, not from a rough support note.

Confirm:

- customer name, email, phone, billing address, and shipping address
- product, variant, SKU, and quantity
- custom-item description and whether it requires shipping
- unit price and currency
- line and order discounts
- shipping method and charge
- tax treatment
- payment method or terms
- quote expiry and inventory-reservation expiry
- any product, destination, or fulfillment restriction

Use a customer record when one exists, but verify its addresses. An old address on a returning customer's profile is not current approval.

For a custom item, write enough detail to identify what will be delivered. “Special product” is not useful for the customer, picker, accounting record, or later dispute. Include specification, quantity, price, and fulfillment expectation in the approved record.

## Price the whole order before sending it

Calculate the customer-facing total in the same sequence they will see it:

> Draft total = products + custom items + shipping + tax and duties − discounts

Then check the commercial result:

> Expected contribution = draft total − product cost − shipping subsidy − payment fees − handling and custom-work cost

The second equation is an internal decision tool, not a Shopify total. It prevents a negotiated price from looking attractive while a custom shipping promise or manual task consumes the margin.

Use explicit discounts rather than hiding the concession in an unexplained custom price. If you do use a custom price, record who approved it and why. For stacked offers, follow the [discount-combination margin controls](/blog/shopify-discount-combinations-margin) before promising the total.

Shopify's [draft-order creation guide](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft) supports custom line prices, discounts, shipping, taxes, tags, markets, and payment terms. Availability and behavior depend on the store, plan, market, and payment setup, so test the exact path you sell.

## Decide whether to reserve inventory

Adding an item to a draft does not automatically make it unavailable to other shoppers. Shopify says reserved draft-order inventory moves into the Committed state until the reservation expires; unreserved units remain Available and can sell elsewhere.

Reserve inventory when:

- the customer has committed to a short decision window
- the item is scarce or made to order
- the quote promises availability
- the team can monitor and release expired reservations

Do not reserve indefinitely. Set an expiry that matches the quote and tell the customer. When the reservation ends, the quote can remain as a price proposal while availability changes.

Before reserving, confirm inventory tracking is active and the units exist at the intended location. If the draft warns that stock is unavailable, stop and investigate. The interface may allow overselling; permission is not evidence that overselling is a good promise.

For high-risk SKUs, connect reservations to the [inventory planning routine](/blog/inventory-planning-solo-store-owners). A pile of forgotten drafts can make available stock look healthier or tighter than the real sales pipeline warrants.

## Send an invoice only after a four-part review

Review the draft as if you were the customer and the fulfillment operator.

### Commercial review

- agreed products and quantities
- prices, discounts, deposit, and payment terms
- currency and market
- quote or payment due date

### Customer review

- email recipient
- billing and shipping addresses
- clear custom-item descriptions
- invoice message and support contact

### Operational review

- inventory and reservation expiry
- shipping rate and service assumption
- fulfillment location and special handling
- realistic lead time

### Compliance review

- tax behavior
- required product or sale restrictions
- refund, cancellation, and delivery promises
- checkout rules that still apply

Shopify's [getting-paid guide](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/get-paid) says an invoice or checkout link lets the customer enter their own payment information in checkout. That is generally cleaner than collecting card details through an improvised support channel.

Preview the invoice copy. State what the customer is buying, when payment is due, how long pricing or inventory is held, and what happens next. Do not write “pay immediately to secure stock” if no inventory reservation exists.

## Treat invoice sent, checkout opened, and payment received as different states

An invoice is a request for payment, not payment. A customer opening checkout is not payment. A pending transaction is not necessarily paid.

Use a status table:

| State | What it proves | Allowed next step |
|---|---|---|
| Draft saved | Internal record exists | Review or revise |
| Invoice sent | Checkout link was sent | Follow up before expiry |
| Customer approved | Terms accepted in a recorded channel | Collect payment under agreed method |
| Paid / payment terms active | Shopify order and financial state exist | Apply fulfillment-release policy |
| Fulfillment released | Order passed payment and operations checks | Pick, pack, and ship |

When payment completes, Shopify converts the draft into a regular order. Refresh the resulting order and verify the financial status, customer, line items, discounts, tax, shipping, notes, and tags before sending it downstream.

## Use “mark as paid” only for money already received

Shopify allows a draft to be marked paid when the merchant has already received the money, such as through an approved manual payment method. The action does not collect the funds again.

Before marking paid, verify:

- the funds were actually received, not merely promised
- amount, currency, date, and payer match the draft
- the payment method is recorded correctly
- the same payment has not already created another order
- any bank, cash, or external-provider reference is retained in the approved system

Never use “mark as paid” to clear a queue, to avoid a checkout error, or because a bank transfer screenshot looks plausible. Reconcile the funds first.

If accepting a card manually, follow Shopify's supported flow and payment-provider requirements. Do not ask a customer to email or message full card details. Shopify's current documentation says manual credit-card acceptance for draft orders is available through Shopify Payments and requires its verification process.

## Recheck stale drafts before collecting payment

Drafts can age while prices, products, variants, inventory, shipping rates, tax settings, and customer needs change. Shopify warns about outdated draft elements at completion and can surface product or rate changes.

For every reopened draft, check:

1. Are the exact products and variants still active and sellable?
2. Are prices and approved discounts still valid?
3. Is the promised shipping rate still available?
4. Is inventory available or still reserved?
5. Are the address, market, currency, and tax result current?
6. Has the quote expired under the store's stated terms?

Do not accept a platform update blindly when it changes the customer agreement. Compare the revised total, tell the customer what changed, and obtain approval before payment.

Shopify currently says draft orders created on or after April 1, 2025 are automatically deleted after one year of inactivity, with edits resetting the timer. That platform-retention rule is not a substitute for the store's own quote-expiry and record-retention policy.

## Release fulfillment from the converted order

After payment or valid payment terms create the order, run a final release check:

- [ ] Draft reason and customer approval are recorded
- [ ] Resulting order number is linked to the request
- [ ] Payment status or payment terms match policy
- [ ] Product, variant, SKU, and quantity are correct
- [ ] Inventory commitment and location are correct
- [ ] Discount, shipping, tax, currency, and total are correct
- [ ] Customer received the right confirmation
- [ ] Draft reservation did not leave duplicate committed stock
- [ ] Fulfillment app received the completed order once
- [ ] Notes and tags tell the operator what is exceptional

Then use the [Shopify fulfillment checklist](/blog/shopify-order-fulfillment-checklist). Do not fulfill from a screenshot of the draft or an emailed quote; fulfill the resulting order whose payment and inventory state you have verified.

## Run a weekly draft-order review

Review open drafts by age and next action:

- waiting for internal pricing
- waiting for customer approval
- invoice sent and unpaid
- inventory reserved and nearing expiry
- payment terms not yet due
- stale, rejected, duplicated, or abandoned

Close or archive work according to the store's policy, release expired inventory reservations, and keep the customer-facing promise consistent with the system state.

Start with the oldest draft that reserves inventory. Confirm whether the customer, payment, and stock commitment are still real. That single record usually reveals whether draft orders are a controlled sales pipeline or an unowned pile of half-orders.
