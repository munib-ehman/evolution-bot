---
title: How to Price Products: Margin Math Most Store Owners Skip
description: Price ecommerce products with margin math that includes product cost, fees, shipping, returns, overhead, discounts, and a worked break-even example.
slug: how-to-price-products-margin-math
date: 2026-08-22
---

To price a product, start with the contribution you need from each sale—not a competitor's price and not a simple “cost times two” rule. Add the costs that change with an order, account for percentage fees, choose a target contribution margin, then check whether the result can cover fixed overhead and still make sense to the customer.

The useful output is not one magical price. It is a floor, a target price, and a clear view of what happens when you discount.

## Do not confuse markup and margin

Markup measures profit relative to cost. Margin measures profit relative to selling price. They are not interchangeable.

Suppose an item costs $20 and sells for $40:

> Markup = ($40 − $20) ÷ $20 = 100%

> Gross margin = ($40 − $20) ÷ $40 = 50%

Calling that a 100% margin would make every later decision wrong. Shopify uses the margin definition—profit divided by price—in its [product details guidance](https://help.shopify.com/en/manual/products/details/product-details-page).

Gross margin is still only a first view. It can exclude fulfillment, payment fees, shipping subsidy, expected returns, and acquisition cost. Use it to compare product economics, then calculate contribution for the actual pricing decision.

## Build the variable cost stack

List costs that increase when you sell one more unit. Use recent actual averages, not the cheapest month you remember.

- product or manufacturing cost
- inbound freight, duties, and inspection allocated per sellable unit
- packaging and pick-and-pack cost
- outbound shipping you absorb
- payment and platform charges that vary with the order
- expected return, damage, and replacement allowance
- royalties or marketplace commissions tied to the sale

Keep fixed monthly overhead—software, base rent, salaries, insurance, and professional fees—separate for now. You will test whether the unit contribution covers it later.

Shopify's Cost per item field can support product and variant margin reporting, but Shopify says that field excludes taxes, shipping, and other costs for resold products. Its [profit report documentation](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports) also notes that profit reports depend on costs recorded when the item sold and that the field is static. Use the report as an input, not proof that every real cost is included.

For a deeper order-level check, use this [true profit per order calculation](/blog/true-profit-per-order-not-just-revenue).

## Price from a target contribution margin

When all variable costs are fixed dollar amounts, the basic formula is:

> Price = variable cost per unit ÷ (1 − target contribution margin)

If payment or marketplace fees are a percentage of the selling price, include that rate in the denominator:

> Price = fixed-dollar variable costs ÷ (1 − percentage fee rate − target contribution margin)

The denominator must stay positive. If your percentage fees plus target margin approach 100%, the assumed economics cannot produce a valid price.

### Worked example

A store is pricing a kitchen tool with these expected per-order costs:

- product and inbound cost: $21
- packaging and fulfillment: $2
- outbound shipping subsidy: $5
- return and replacement allowance: $2
- fixed-dollar variable costs: $30
- payment fees: 3% of selling price
- target contribution margin: 25%

Apply the formula:

> $30 ÷ (1 − 0.03 − 0.25) = $41.67

At a rounded $42 price, the estimated payment fee is $1.26. After $30 of other variable costs, contribution is $10.74, or about 25.6% of the selling price.

This is a model, not a promise. Carrier rates, return behavior, and product mix will move. Replace every example input with your own trailing data, and calculate at the variant level when costs differ.

## Check whether unit contribution covers the business

A healthy-looking unit margin can still leave the store short if volume cannot cover fixed costs.

Use:

> Break-even units = monthly fixed costs ÷ contribution per unit

If fixed costs are $2,200 and contribution is $10.74, the business needs about 205 units a month to cover those fixed costs before owner profit and tax.

Then run three cases:

- **Base:** realistic current volume and return rate
- **Weak month:** fewer units, higher shipping, or more returns
- **Promotion:** discounted selling price and higher expected volume

Do not bury owner pay by pretending your time is free. Decide whether it belongs in fixed overhead or your profit target and use the same treatment each month.

Fixed app costs also deserve a regular review. This guide to the [average Shopify app stack cost](/blog/average-shopify-app-stack-cost-per-month) shows how small recurring tools can raise the break-even point.

## Find your discount floor before launching a sale

A discount cuts contribution faster than it cuts revenue because most unit costs do not fall with the selling price.

At the $42 example price, a 15% discount produces a $35.70 selling price. With a 3% fee, the estimated contribution becomes:

> $35.70 − $30 − $1.07 = $4.63

That is about a 13% contribution margin, roughly half the dollar contribution of the full-price order. If the promotion does not create enough genuinely incremental orders, it can raise revenue while reducing the cash available to cover overhead.

Record three numbers for every SKU:

1. regular price and expected contribution
2. lowest planned promotional price and contribution
3. absolute floor below which the order no longer supports the business

Include shipping offers in this check. “Free” shipping is still a store cost, and the right threshold depends on actual order economics. Use the [free shipping threshold formula](/blog/free-shipping-threshold-how-to-set-yours) before treating shipping as a promotional afterthought.

## Use competitors as a market check, not a calculator

Competitor prices tell you what alternatives a shopper sees. They do not reveal the competitor's product cost, return rate, wholesale mix, cash position, or required margin.

After calculating your target price, compare products with similar quality, package size, warranty, service, and delivery terms. If your sustainable price is much higher, choose deliberately:

- explain and prove the extra value
- reduce the variable cost without reducing the customer outcome
- change the bundle or package size
- sell through a channel with different economics
- accept a lower target margin for a strategic item
- stop carrying a product that cannot support itself

Do not quietly remove necessary costs from the spreadsheet until the desired price appears. That makes the model prettier, not the product more profitable.

## Keep sale and compare-at pricing honest

In the United States, the current [FTC Guides Against Deceptive Pricing](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233) say a former price used for a comparison should be a genuine price offered openly and in good faith, not an inflated figure created to advertise a false reduction. Other countries and US states can impose additional rules.

Keep records of when a regular price was offered and sold, and do not use a fictional compare-at price to make the target price look cheaper. Check the requirements for every market where you sell; this article is operating guidance, not legal advice.

## Put the price into Shopify and monitor the result

Shopify recommends considering marketing, subscription, and transaction expenses when pricing products, alongside product cost and the value you provide. Its [pricing guidance](https://help.shopify.com/en/manual/products/dropshipping/creating-a-product-line/pricing-your-products) is a useful platform-level checklist.

After updating a price:

- enter accurate cost data for every variant
- confirm tax settings, currencies, unit pricing, and compare-at displays
- test product, cart, checkout, and discount behavior on mobile
- monitor unit contribution, conversion, returns, and support feedback
- review after supplier, carrier, fee, or product changes

A conversion dip does not automatically mean the price is wrong, and a revenue lift does not prove it is right. Review contribution dollars over a representative period. Low-volume stores should avoid conclusions after a few orders.

## A one-page pricing worksheet

For each SKU, keep:

- selling price
- product and inbound cost
- packaging and fulfillment
- shipping subsidy
- percentage fees
- return or replacement allowance
- contribution dollars and margin
- regular and promotional price floors
- expected monthly units
- share of fixed overhead covered
- date and reason for the next review

Start with your five highest-volume products. Replace estimates with actuals, calculate the promotion floor, and identify the one SKU where a small cost or price change has the largest effect on monthly contribution. That is a more useful first pricing decision than copying another store's number.
