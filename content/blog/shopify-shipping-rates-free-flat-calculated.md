---
title: Shopify Shipping Rates: Free vs Flat vs Carrier-Calculated
description: Choose Shopify shipping rates that protect margin and set clear expectations. Compare free, flat, and carrier-calculated options with practical math.
slug: shopify-shipping-rates-free-flat-calculated
date: 2026-10-12
---

The right Shopify shipping rate is the one that gives customers a clear cost while keeping the store's actual delivery expense predictable enough to manage. For many small stores, that means a hybrid: one simple flat rate for ordinary domestic orders, free shipping above a profitable threshold, and calculated or separate rates for expensive exceptions.

Do not choose a strategy from a competitor's banner. Start with your own parcels, zones, and margins, then decide where the store can absorb cost and where the customer needs to pay it.

## Choose from three basic strategies

Shopify's current [shipping strategy guide](https://help.shopify.com/en/manual/fulfillment/setup/shipping-rates/shipping-strategy) describes three main choices: flat, free, and carrier-calculated shipping. Each solves a different problem.

| Strategy | Best fit | Main risk |
|---|---|---|
| Flat rate | Package costs cluster in a narrow range | Remote, heavy, or oversized orders can lose money |
| Free shipping | Margin can fund delivery or a threshold lifts the basket | The store absorbs more cost than the price supports |
| Carrier-calculated | Cost varies materially by weight, size, speed, or destination | The customer sees an unattractive surprise at checkout |

Local pickup and local delivery can sit beside these options when you serve a nearby area. You do not have to force every product and destination into one global rule.

## Build the baseline from shipped orders

Export a useful sample of fulfilled orders—usually enough weeks to include normal variation—and add these fields:

- order subtotal after discounts
- product gross margin
- destination zone
- package type, weight, and dimensions
- carrier service
- amount the customer paid for shipping
- label cost, packaging, and any fulfillment handling cost
- surcharge, duty, or adjustment the store paid

Then calculate two numbers for each order:

> Shipping recovery = customer shipping charge / store shipping and packaging cost

> Contribution after shipping = product contribution + customer shipping charge − store shipping and packaging cost

A 100% shipping-recovery rate is not automatically the goal. You might intentionally subsidize standard shipping because it improves the offer. The important part is seeing that subsidy and confirming the remaining contribution can support it. Use the same cost categories as the [true profit per order calculation](/blog/true-profit-per-order-not-just-revenue).

Group the results by zone and package family. The overall average can hide a useful pattern: small domestic parcels might cost about the same while one oversized product or remote region creates nearly all of the variance.

## When a flat rate is the cleanest answer

A flat rate works well when most orders use similar packaging and the expensive outliers are limited. It gives the customer a number you can publish before checkout and keeps the choice easy to understand.

Set it from a weighted average, not the cheapest parcel:

> Proposed flat rate = expected average carrier cost + packaging and handling − planned store subsidy

Suppose a fictional order mix produces an $8.40 average label cost, $0.90 of packaging, and a deliberate $3 shipping subsidy. A $6.30 flat rate would recover the remaining expected cost. Round only after checking what that rounded number does across the full order sample.

One flat rate does not need to cover every case. Use a separate shipping profile for an oversized, fragile, refrigerated, or otherwise expensive product. Use different zones where destination economics are genuinely different. Keep the ordinary path simple and isolate the exception instead of charging every customer for the costliest parcel.

Review the rate when carrier prices, packaging, fulfillment location, or product mix changes. A flat rate becomes a quiet margin leak when it remains fixed while the underlying cost moves.

## When free shipping is affordable

Free shipping is a price decision, not a cost disappearing. The store pays through product margin, higher prices, a larger basket, or some combination of the three.

There are three common versions:

1. **Free on every order:** easiest to explain, but difficult for low-priced or low-margin baskets.
2. **Free above an order value:** asks the customer to build a larger basket before the store absorbs delivery.
3. **Free for selected products or markets:** useful when margin and parcel economics differ sharply.

Shopify's [rate setup documentation](https://help.shopify.com/en/manual/fulfillment/setup/shipping-rates/setting-up-shipping-rates) allows free shipping conditions on eligible rates and custom profiles for selected products. It also warns that amount- or weight-based tiers must cover the full range; a gap can leave a customer with no available shipping rate.

If you use a threshold, calculate it from current order value, contribution margin, and shipping cost. The full [free shipping threshold guide](/blog/free-shipping-threshold-how-to-set-yours) walks through that math. Do not simply add shipping cost to every product when customers commonly buy several units; that can recover the same shipment cost multiple times inside one basket.

## When carrier-calculated rates protect the store

Calculated rates are useful when a truthful fixed price would be either too high for ordinary orders or too low for costly ones. Shopify says its carrier-calculated rates can use origin, destination, shipment value, weight, package dimensions, dimensional weight, and requested speed.

That accuracy depends on the catalog and package data. Before turning calculated rates on:

- weigh every sellable variant accurately
- enter realistic default and alternate package dimensions
- test multi-item packing outcomes
- confirm the correct fulfillment origin
- check rural, remote, and high-cost destinations
- decide whether packaging and handling need a rate adjustment

Calculated transit time does not include your processing time. If the customer needs an arrival expectation, configure fulfillment time and delivery dates rather than presenting a carrier transit estimate as the whole promise.

The tradeoff is visibility. The final cost is calculated at checkout, where a large surprise can end the purchase. If you use calculated shipping, show an estimator or an honest range earlier where practical, explain what affects the price, and test the routes that matter most. This complements the broader work in the [checkout abandonment guide](/blog/reduce-abandoned-checkouts-shopify).

## Use a hybrid when the catalog is uneven

A practical small-store structure might be:

- $6 standard domestic shipping for ordinary parcels
- free standard shipping at a tested threshold
- a faster paid option for customers who need it
- calculated or separate rates for oversized products
- distinct international zones with only services you can reliably fulfill

This is not a universal template. It is an example of keeping the common path predictable while pricing exceptions from evidence.

Avoid adding five nearly identical service names. A customer usually needs to understand cost, speed, tracking, and any important limitation. More choices are not helpful when the differences are invisible.

## Test the entire rate table before launch

Shopify's setup guide notes that rates are controlled by zones, profiles, and conditions. Test combinations, not just one local address:

- below, at, and above each order-value threshold
- light and heavy carts
- one ordinary item plus one profile exception
- every important domestic zone
- a remote address
- each enabled international market
- every promised delivery speed
- carts above the highest configured tier

For each test, record the displayed rate, expected label cost, delivery wording, and contribution after shipping. Confirm there is always at least one valid rate for every cart you intend to accept.

If you publish delivery dates, connect them to actual processing time and carrier transit. The [holiday cutoff workflow](/blog/holiday-shipping-cutoffs-ecommerce) shows why a shipping service name alone is not an arrival promise.

## Measure the strategy after it goes live

Review the first four weeks and then monthly:

- shipping charged versus label, packaging, and handling cost
- contribution after shipping by zone and product profile
- checkout completion by displayed shipping option
- average order value around the free-shipping threshold
- orders with no rate or an unexpected fallback rate
- upgrades to faster service
- support contacts about cost or delivery timing

Do not celebrate a higher conversion rate if shipping subsidies removed the added contribution. Do not celebrate perfect cost recovery if a late checkout surprise drove away profitable orders. Evaluate the order economics and the customer outcome together.

Start with the last 100 representative shipments. Separate the ordinary parcels from the expensive exceptions, price the common path simply, and test every boundary before customers do it for you.
