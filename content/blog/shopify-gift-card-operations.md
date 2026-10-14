---
title: Shopify Gift Card Operations: Sales, Refunds, and Balances
description: Run Shopify gift cards without losing track of sold cards, promotional cards, refunds, deactivations, outstanding balances, or customer support exceptions.
slug: shopify-gift-card-operations
date: 2026-10-14
---

Shopify gift cards are simple for a customer and easy for a small store to mishandle behind the scenes. A sold card brings in cash before merchandise leaves. An issued promotional card creates value without a sale. A redemption records product sales later. Refunds, deactivations, currencies, and missing codes create their own exceptions.

The practical system is to separate purchased cards from store-issued cards, limit who can create or deactivate them, reconcile the outstanding balance, and give support a clear path for refunds and lost-code requests. Do not treat gift-card cash as ordinary product revenue or run promotions without a record of the value issued.

## Separate the three events

Do not collapse sale, issuance, and redemption into one number.

### A customer buys a gift card product

The customer pays now and receives value usable later. Shopify's current [finance-report documentation](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report) says the payment appears in payment reporting and the gift-card product appears in the Net sales from gift cards report, but the gift card is not counted as normal product sales at that point.

### The store creates a gift card

A merchant can create a card in the Shopify admin without taking payment. Shopify's [creating gift cards guide](https://help.shopify.com/en/manual/products/gift-card-products/issue-gift-card) lists uses such as a promotion, incentive, reward, or refund. This event is not a customer purchase, so track the business reason and approver.

### A customer redeems a gift card

The purchased merchandise is recorded as sales when it is bought. The amount paid with the gift card reduces the outstanding card balance. That timing is why deposits, sales, and gift-card balances will not line up by simply comparing one day's totals.

For accounting and tax treatment, use a qualified professional for the jurisdictions where the store operates. Shopify's reports are operational evidence; they do not replace the store's accounting policy.

## Create two controlled ways to issue value

Use a gift card product when the customer is buying the card. Use an admin-created card when the store is intentionally granting value without a normal card sale.

For every store-issued card, record:

- reason: refund, service recovery, promotion, loyalty, or another approved case
- customer or campaign
- amount and currency
- approver
- related order or support case
- expiry, if used and legally permitted
- date created
- whether it can be redeemed across currencies

Do not let a support macro become an unlimited authority to create value. Set approval bands, for example: support can issue up to the documented service-recovery limit; anything higher needs owner approval. The amounts should come from the store's real economics, not a generic benchmark.

If cards are part of a loyalty program, apply the same margin and eligibility rules described in [simple loyalty programs for small stores](/blog/loyalty-programs-small-stores-simple). Shopify currently recommends Flow for automated promotions such as issuing a gift card after a qualifying order. Test the trigger, cancellation behavior, return handling, and duplicate-run protection before enabling it.

## Protect card codes like payment value

Shopify displays only the last four characters of a gift card code in the admin after creation. The full code is sent to the customer and cannot later be viewed by staff in the admin. Shopify's current [gift-card management guide](https://help.shopify.com/en/manual/products/gift-card-products/manage-purchased-gift-cards) also says the standard CSV export includes only the final four characters.

That design should shape the support process:

- never ask a customer to send a full code in an ordinary support message
- search using the customer, order, or last four characters when available
- resend the card from Shopify to the original customer rather than copying a code
- restrict export access
- do not store full codes in tickets, notes, or spreadsheets
- escalate unexpected balance or redemption activity before creating replacement value

If the customer says a code was stolen or used without permission, preserve the card timeline and related order records. Deactivating a card is permanent, so verify identity, remaining balance, and the replacement decision before acting.

## Design the refund path before the first exception

There are two different refund questions.

### Refunding an order paid with a gift card

Shopify says a refund can be applied back to the gift card and its balance updates automatically. For a partial refund paid with a gift card plus another method, the allocation can be adjusted, but the default behavior can apply value to the gift card first.

Check:

- original payment methods
- amount being returned to each method
- whether the original gift card is active and unexpired
- whether Shopify Payments was used when reloading through a return or exchange
- customer communication about where the value went

An expired card may need a temporary expiry change before refunding. A deactivated card cannot be reactivated or reloaded; Shopify directs merchants to issue a new card instead.

### Refunding the purchase of a gift card product

A purchased gift card can be refunded, and Shopify says the refunded card is automatically deactivated. A card created directly in the admin or Shopify POS has no captured purchase payment to refund.

Support should never say “refund completed” until both the payment action and card state are verified. Link the customer-facing response to the broader [returns workflow](/blog/returns-without-losing-the-customer), but keep the gift-card-specific checks in the operational checklist.

## Treat deactivation as irreversible

Shopify does not let merchants delete a created gift card. A deactivated card remains in the admin and cannot be reactivated, reloaded, or used.

Before deactivation, record:

1. why the card must stop working
2. who requested and approved the action
3. current balance and currency
4. whether a replacement or refund is required
5. related order, customer, or incident
6. the customer message to be sent

Do not deactivate old cards merely to make a liability report smaller. If the business believes value can expire or be removed, confirm the applicable contract and law before changing customer value.

## Reconcile the outstanding balance monthly

Use at least three Shopify views because they answer different questions:

| View | Question it answers |
|---|---|
| Net sales from gift cards | What purchased gift-card products were sold, after relevant discounts and reversals? |
| Outstanding gift card balance | How did created, redeemed, refunded, deactivated, and ending balances change? |
| Gift card page or CSV | Which cards exist, how were they issued, and what balances remain? |

Shopify warns that these totals can differ. The CSV is organized around created cards and can include cards issued without a sale. The Net sales from gift cards report is based on gift-card product sales. The outstanding-balance report tracks balance movements.

A monthly operational reconciliation can follow this bridge:

> Ending outstanding balance = beginning balance + cards sold or issued + refunds returned to cards − redemptions − deactivated value ± supported adjustments

Use the labels and values from the store's actual reports; the expression above is a control concept, not a substitute for Shopify's columns or accounting entries.

Investigate:

- large cards issued without a related order or case
- duplicate promotional issuance
- unexpected deactivations
- refunds that went to a different method than support promised
- old high-balance cards needing customer-service review
- currency or cross-currency differences
- a report change without a clear underlying event

Tie the ending balance into the store's [13-week cash flow forecast](/blog/ecommerce-13-week-cash-flow-forecast) only through a documented redemption assumption. Cash collected from a card sale can sit in the bank while the store still owes future merchandise or service.

## Review currency choices before issuing the card

Shopify supports gift cards in activated market currencies and documents optional cross-currency redemption. The setting can expose the merchant to exchange-rate drift between issuance and redemption and cannot be changed after the card is created.

Before issuing across markets, decide:

- the card currency
- whether checkout in other currencies is allowed
- who absorbs exchange-rate movement
- how customer support explains the usable value
- which payout and accounting currency owns the reconciliation

Do not promise a fixed value in another currency unless the store's configuration and policy support that promise.

## Use a weekly exception review and monthly balance review

Weekly, review:

- newly issued admin-created cards
- unusually large values
- cards issued by automation
- failed or duplicate promotion triggers
- deactivations and replacement cards
- unresolved refund or code-access tickets

Monthly, review:

- purchased versus issued value
- redemptions and refunds
- deactivated value
- ending outstanding balance by currency
- differences between report totals and CSV populations
- approvals and evidence for manual issuance

If gift cards are discounted or allowed to combine with promotions, test the worst eligible cart using the [discount-combination margin framework](/blog/shopify-discount-combinations-margin). Gift cards act as payment value, but the products purchased with them can still carry discounts, shipping subsidies, returns, and fulfillment costs.

Start by exporting the current gift-card list and opening the outstanding-balance report for the same date. Separate purchased, issued, and app-generated cards. Any value with no clear customer, campaign, or approval is the first exception to investigate.
