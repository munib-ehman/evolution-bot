---
title: Revenue Leaks: 7 Places Small Ecommerce Stores Lose Money
description: Find seven common revenue leaks in a small ecommerce store, calculate their monthly cost, and rank fixes using Shopify's existing reports and bills today.
slug: revenue-leaks-small-ecommerce-stores
date: 2026-08-27
---

A revenue leak is money your store already earned or nearly earned, then lost through a cost, policy, or process nobody reviews closely. It is not the same as slow growth. Buying more ads will not fix a margin leak, and a busier month can make one harder to notice.

The useful way to find leaks is to reconcile one month from gross sales down to contribution profit, then investigate each gap. You can do most of this with Shopify reports, carrier bills, ad-platform spend, and your app invoices.

## Build one monthly leak sheet

Choose a completed 30-day period and create these columns:

| Line | Amount | Source | Confidence | Owner |
|---|---:|---|---|---|
| Gross sales |  | Shopify finance report | High | Owner |
| Discounts |  | Discounts by order | High | Marketing |
| Returns and refunds |  | Finance and returns reports | High | Support |
| Product cost |  | Profit report plus cost records | Medium | Operations |
| Shipping subsidy and adjustments |  | Carrier and Shopify bills | High | Operations |
| Payment and international fees |  | Payments and analytics reports | High | Finance |
| Paid acquisition |  | Ad platforms | Medium | Marketing |
| Apps and recurring tools |  | Shopify and vendor bills | High | Owner |

Do not force every number into Shopify. The point is a complete bridge from sales to money kept, with a source beside every figure. The [true profit per order worksheet](/blog/true-profit-per-order-not-just-revenue) is the right next step when one product or channel looks suspicious.

## Leak 1: product costs are missing or stale

Shopify's [profit reports](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports) calculate profit only for products and variants that had a cost recorded when they sold. Shopify also notes that the cost-per-item field is static. If supplier prices, packaging, duties, or assembly costs changed but the catalog cost did not, the margin report can look healthier than reality.

Run two checks:

1. Find net sales without a recorded cost and assign every material SKU a current cost.
2. Compare the recorded cost of your top 20 variants with the latest supplier invoice or purchase order.

For a manufactured product, keep a separate landed-cost sheet if the Shopify field cannot represent materials, labor, inbound freight, and duties cleanly. Record the method, not just the answer, so next month's update uses the same definition.

## Leak 2: discounts stack beyond the planned offer

An individual promotion can be sensible while the combined order is unprofitable. Shopify supports eligible combinations of product, order, and shipping discounts, and its current [discount-combination documentation](https://help.shopify.com/en/manual/discounts/discount-combinations) explains that multiple discounts can apply when each is configured to combine.

Export Discounts by order and sort by discount amount as a percentage of gross product sales:

> Effective discount rate = total discount value / gross product sales

Inspect the largest orders first. Look for welcome codes combined with automatic product offers, loyalty rewards combined with free shipping, or old campaign codes still active. Do not judge a promotion by revenue attributed to the code alone. Compare net sales, product cost, shipping subsidy, and acquisition cost for the orders that used it.

## Leak 3: returns are reported, but their full cost is not

Shopify's [finance-report definitions](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report) separate gross sales, discounts, sales reversals, shipping charges, and return fees. That makes the sales reversal visible, but your operational loss can also include outbound shipping, return shipping, inspection time, damaged packaging, and inventory that cannot return to full-price stock.

Calculate a return cost by product or reason:

> Return cost = refunded revenue + unrecovered shipping + handling + write-down − retained fees

Use actual return reasons rather than a blended store average when possible. A sizing issue needs a product-page fix; damage in transit needs packaging or carrier work; a misleading color photo needs better media. The [returns guide](/blog/returns-without-losing-the-customer) covers the customer experience, while this exercise measures the financial consequence.

## Leak 4: shipping revenue does not match shipping expense

Customer-paid shipping appears in sales reporting, while label purchases and later carrier adjustments can land elsewhere. Shopify's [shipping-label billing guide](https://help.shopify.com/en/manual/fulfillment/shopify-shipping/billing-and-taxes) says carriers can debit or credit a label after verifying package details, and those adjustments can arrive after the shipment.

For each market or shipping zone, calculate:

> Shipping subsidy per order = label cost + adjustments + packaging − shipping charged to customer

A subsidy can be intentional. The leak is not knowing its size or applying the same policy to destinations with very different costs. Review orders just above your free-shipping threshold and remote-zone orders separately. If the subsidy is larger than the incremental margin the threshold creates, revisit the [free-shipping threshold math](/blog/free-shipping-threshold-how-to-set-yours).

## Leak 5: payment, currency, and market fees disappear from the sales view

Sales and payouts answer different questions. Shopify's finance documentation distinguishes order-based sales from captured payments and payout activity. Its current [analytics field reference](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields) includes payment-processing, foreign-exchange, and Managed Markets fee fields.

Reconcile payouts to orders for at least one normal week. Separate:

- payment-processing fees
- third-party transaction fees, if applicable
- currency-conversion and international fees
- reserves, disputes, or adjustments that affect payout timing

Do not subtract taxes collected as if they were an operating expense, and do not treat payout timing as revenue timing. The goal is to identify fees that change the contribution from an order or market.

## Leak 6: acquisition is judged against revenue, not contribution

A campaign with a strong return on ad spend can still lose money when the product has a low margin, a large discount, or expensive fulfillment. Set a break-even acquisition ceiling for each important product group:

> Break-even CAC = net sales − product cost − fulfillment − payment fees − expected return cost

This is a ceiling, not a target. It leaves nothing for payroll, software, or profit. Compare it with actual customer acquisition cost by channel, using the same attribution window and customer definition each time. The [CAC versus LTV guide](/blog/cac-vs-ltv-small-ecommerce-stores) is useful when repeat purchases materially change what you can afford, but do not borrow future lifetime value to excuse a first order that is far outside plan.

## Leak 7: recurring tools survive after their job disappears

Shopify's [billing guide](https://help.shopify.com/en/manual/your-account/manage-billing/billing-charges/types-of-charges) separates subscription, app, shipping, and transaction charges. It also notes that app developers can bill recurring, usage-based, or one-time fees, while some third-party vendors bill outside Shopify entirely.

Make one list from the Shopify bill, card statement, PayPal, and any accounts-payable tool. For every recurring item, record:

- the problem it solves
- the person who uses its output
- the last verified result
- any overlapping feature in another tool
- the safe removal and rollback steps

Do not uninstall a production app during the audit. First confirm what storefront code, data, or automation depends on it. Use the [Shopify app stack audit](/blog/average-shopify-app-stack-cost-per-month) to evaluate overlap without turning cost cutting into an outage.

## A worked monthly example

Consider a hypothetical store with this 30-day bridge:

| Item | Amount |
|---|---:|
| Gross product sales | $42,000 |
| Discounts | −$2,800 |
| Returns | −$1,900 |
| Net product sales | $37,300 |
| Product cost | −$14,000 |
| Shipping subsidy and adjustments | −$3,100 |
| Processing and international fees | −$1,400 |
| Paid acquisition | −$9,000 |
| Apps and recurring operations tools | −$1,100 |
| Contribution before payroll and overhead | $8,700 |

Gross sales says $42,000. The decision-making number in this example is $8,700 before payroll, rent, tax, and other overhead. A ten-percent lift in sales is not automatically the best project: correcting a $1,000 recurring leak could be faster, safer, and more profitable.

## Rank fixes without guessing

Score each confirmed leak on three dimensions from 1 to 3:

> Priority = monthly dollars × confidence × reversibility

A high-cost duplicate app with clear evidence and a safe rollback belongs near the top. A suspected attribution problem with weak evidence belongs in investigation, not immediate action. Assign one owner, one change, and one verification date to the top item.

Start with the leak you can prove. Fix it, keep the rest of the monthly bridge unchanged, and compare the next complete period using the same definitions. That is how you turn a vague feeling that money is disappearing into a controlled operating improvement.
