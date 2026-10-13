---
title: Shopify Discount Combinations: Protect Margin When Offers Stack
description: Learn how Shopify discount combinations apply, model the worst eligible cart, set margin guardrails, test checkout, and audit stacked offers after launch.
slug: shopify-discount-combinations-margin
date: 2026-10-13
---

Shopify discount combinations let more than one eligible offer affect the same order. That can create a clear customer benefit: a product promotion, a loyalty reward, and free shipping can work together. It can also turn a healthy cart into an unprofitable one if each offer was approved in isolation.

The control is not “never stack discounts.” It is to map every active offer, model the worst cart that qualifies, configure combinations deliberately, test checkout, and compare post-launch contribution with the approved floor.

## Start with the three discount classes

Shopify organizes discounts into product, order, and shipping classes. Its current [discount-combination documentation](https://help.shopify.com/en/manual/discounts/discount-combinations) explains which classes can combine and the order in which eligible savings are calculated.

Build one register with a row for every code, automatic discount, app-generated offer, loyalty reward, and recurring promotion:

| Field | Why it matters |
|---|---|
| Name and owner | Someone must approve changes and expiry |
| Class | Product, order, or shipping |
| Method | Code, automatic, app, or manual |
| Eligibility | Product, collection, customer, market, minimum |
| Value | Percentage, fixed amount, Buy X Get Y, or free shipping |
| Combination settings | Which other classes it permits |
| Start and end | Prevent forgotten campaigns |
| Use limits | Total and per-customer controls |
| Margin floor | Lowest approved contribution after the offer |

Do not assume an app's offer appears or behaves like a native discount. Record where it is configured and test the actual checkout path.

## Understand how eligible discounts apply

Combination permission must work from both sides. Shopify says multiple discounts apply only when each discount's settings permit the relevant combination. If eligible discounts cannot combine, Shopify applies the best available discount or combination for the customer.

Calculation order also matters. Shopify's documentation says product discounts apply before order discounts, and shipping discounts then affect eligible shipping. A percentage applied later therefore uses a different base than a simple sum of percentages.

Consider this hypothetical cart:

| Line | Amount |
|---|---:|
| Product subtotal | $100.00 |
| 20% product discount | −$20.00 |
| Subtotal after product discount | $80.00 |
| 10% order discount | −$8.00 |
| Discounted product revenue | $72.00 |
| Normal shipping charge | $8.00 |
| Free shipping discount | −$8.00 |
| Customer total before tax | $72.00 |

The product and order discounts did not create a flat 30% calculation on the original subtotal: the second percentage applied after the first. But the store also absorbed the $8 shipping charge. That is why one headline discount rate cannot describe the full cost.

Shopify's current page also documents checkout limits, including up to five product or order discount codes and one shipping discount code per order, as well as a separate limit on active automatic discounts. These platform limits can change; treat the linked Shopify documentation as the source of truth rather than hard-coding them into a permanent campaign rule.

## Calculate contribution after every eligible saving

Use contribution, not revenue, to approve a combination:

> Contribution after promotion = discounted product revenue + shipping charged − product cost − fulfillment cost − store-paid shipping − payment fees − expected return cost − attributable acquisition cost

Extend the hypothetical cart. Assume the store's internal inputs for this example are:

- product cost: $42.00
- pick, pack, and packaging: $6.00
- store-paid shipping: $8.00
- payment fee: $2.50
- acquisition cost assigned to the order: $12.00

The contribution is:

> $72 − $42 − $6 − $8 − $2.50 − $12 = $1.50

The order is still positive before overhead in this example, but it has almost no room for a return, reshipment, support time, or profit. Use your real inputs and the [true profit per order framework](/blog/true-profit-per-order-not-just-revenue); the numbers above are illustrative, not a benchmark.

Model at least four carts for every new promotion:

1. the minimum cart that qualifies
2. the most common expected cart
3. a low-margin product mix
4. the worst eligible stack with shipping and loyalty benefits

If the minimum qualifying cart fails the floor, the campaign is not ready merely because the average cart looks healthy.

## Set guardrails inside the offer

Use the narrowest rule that still delivers the intended customer benefit:

- minimum purchase amount or quantity
- eligible products or collections
- eligible customer segment
- market or channel where supported
- total use limit
- one use per customer
- clear start and expiry
- combination permission by class
- maximum shipping benefit or eligible method where supported

The Shopify [discount FAQ](https://help.shopify.com/en/manual/discounts/discounts-faq) confirms that code usage can be limited in total and to one use per customer, and that the Sales by discount report shows code usage. Limits reduce exposure; they do not replace margin math.

Be careful with free shipping. If the shipping benefit can apply to remote, heavy, or oversized carts, model those costs separately. The [free-shipping threshold guide](/blog/free-shipping-threshold-how-to-set-yours) shows how to compare threshold lift with the subsidy the store absorbs.

## Audit the exceptions to combination settings

Not every price reduction follows the same control. Shopify's combination guide says custom discounts manually applied to a POS cart or draft order can apply regardless of other combination settings. Apps can also create or alter discount behavior.

Include these in the audit:

- active automatic discounts nobody remembers launching
- codes embedded in welcome, recovery, creator, and support emails
- loyalty points converted into codes
- subscription or bundle pricing
- manual POS and draft-order discounts
- app-generated gifts or price changes
- sale prices using compare-at pricing
- store credit or gift cards, which are payment value rather than the same kind of discount

The [revenue leak audit](/blog/revenue-leaks-small-ecommerce-stores) is useful here because it compares discount cost with product cost, shipping subsidy, fees, and acquisition instead of judging a promotion by attributed sales alone.

Assign an owner and expiry to each entry. Deactivate an old offer only after checking live links, scheduled messages, affiliates, and customer-service promises that still reference it.

## Test a combination matrix before launch

Use a test plan that reflects eligibility boundaries:

| Test cart | Expected result |
|---|---|
| Below the minimum | No offer |
| Exactly at the minimum | Intended offer applies |
| Eligible and excluded products together | Only intended lines change |
| Product plus order discount | Correct sequence and total |
| Product or order plus shipping | Correct service and subsidy |
| Ineligible customer or market | Offer rejected clearly |
| Maximum eligible stack | Contribution stays above floor |
| Return or partial refund scenario | Refund treatment is understood |

Test storefront, mobile, accelerated checkout, subscriptions, POS, and other relevant channels separately. Shopify notes that discount behavior can vary by sales channel and checkout setup. An admin preview does not prove the customer's checkout result.

Save the test order numbers, screenshots, inputs, and expected totals. If an app or automatic discount appears unexpectedly, stop and update the register before launching.

## Review the first complete orders, then the full period

On launch day, inspect the first successful orders that use each intended combination. Confirm:

- the right products received the product discount
- the order discount used the expected subtotal
- the shipping benefit applied only to the intended service
- taxes and refunds follow the store's configured rules
- no unplanned automatic or app discount appeared

After a complete reporting period, calculate:

> Effective discount rate = total discount value / gross product sales

Then compare orders using the combination with a relevant baseline:

- contribution per order
- conversion rate and completed orders
- average order value
- shipping subsidy
- acquisition cost
- return and refund rate
- new versus returning customer mix

A higher conversion rate does not rescue a campaign that loses contribution on every incremental order. A lower margin per order can still be deliberate if it acquires customers who later buy profitably, but label that as an investment and set a review window rather than assuming lifetime value will appear.

## A weekly discount-control routine

Keep the control light enough to repeat:

1. Review active automatic, code, app, and manual offers.
2. Find campaigns ending or launching in the next two weeks.
3. Test every newly possible combination on the minimum and worst eligible carts.
4. Inspect the largest effective discounts in recent orders.
5. Reconcile discount value, shipping subsidy, and contribution.
6. Deactivate expired offers after checking live references.
7. Record the owner, decision, and next review date.

Start with the current active-discount list and one low-margin cart. If nobody can explain exactly which savings apply and what remains after product, fulfillment, shipping, fees, and acquisition, pause the next promotion until that answer is clear.
