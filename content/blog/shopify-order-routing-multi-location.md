---
title: Shopify Order Routing for Multi-Location Stores
description: Set up Shopify order routing across locations. Rank warehouses, reduce split shipments, test rules, and troubleshoot unexpected fulfillment assignments.
slug: shopify-order-routing-multi-location
date: 2026-10-21
---

Shopify order routing decides which location should fulfill each item in an online order. For a multi-location store, that choice affects shipping cost, delivery time, split packages, inventory balance, and the amount of manual reassignment your team handles.

The useful setup is not “always choose the nearest building.” It is a short ordered strategy that reflects the store's real priority: keep an order together where possible, stay inside the right market, favor the locations designed for ecommerce, and use proximity to break sensible ties.

## Start with an explicit routing objective

Before changing a rule, decide what good routing means for the store. Common objectives compete with one another:

- **Fewer packages:** reduce split shipments and duplicated postage.
- **Shorter delivery distance:** ship closer to the customer.
- **Warehouse first:** protect retail-store labor and shelf stock.
- **Market alignment:** fulfill inside the customer's destination market where possible.
- **Inventory balance:** draw from overstocked locations before creating another transfer.

Choose one primary objective and two guardrails. For example:

> Primary: minimize split fulfillments. Guardrails: use a warehouse before a retail store, then choose the closest equally ranked warehouse.

That sentence is testable. “Optimize fulfillment” is not.

Shopify's current [order routing overview](https://help.shopify.com/en/manual/fulfillment/setup/order-routing/understanding-order-routing) says rules run in sequence, with each rule applied to the locations still prioritized by the preceding rule. Order matters because later rules refine the earlier result rather than starting over.

## Make every location eligible on purpose

A routing strategy cannot fix incomplete location setup. For every warehouse, store, 3PL, or app location, verify:

- the address is complete and verified
- it should or should not fulfill online orders
- the correct products are stocked and active there
- inventory quantities reflect physical stock
- shipping profiles include the location for the relevant products and destinations
- delivery methods and carrier access match what the location can actually execute
- handling time, cutoff, and staffing expectations are documented

Shopify's [location fulfillment guidance](https://help.shopify.com/en/manual/inventory-and-locations/locations/fulfillment) explains that product-specific fulfillment can be controlled through shipping profiles, while routing rules prioritize among eligible locations. Keep those jobs separate: profiles define who can fulfill a product and destination; routing decides which eligible location should win.

If a location is for storage only, do not leave online fulfillment active and hope ranking keeps it out of orders. Exclude it clearly.

## Understand the default rules

Shopify's documented default strategy applies these rules in order:

1. Minimize split fulfillments
2. Stay within the destination market
3. Ship from the closest location

Each rule solves a different problem.

### Minimize split fulfillments

This rule prioritizes locations that can fulfill the whole order. When no single location can do that, it favors the fewest packages. It can reduce splits, not guarantee that every order stays together.

Use it near the top when extra parcels materially increase postage, packaging, labor, or customer confusion. Also fix the inventory placement that causes repeated splits; routing cannot compensate forever for every fast seller being scattered across the network.

### Stay within the destination market

This rule favors locations in the customer's destination market. It can help avoid routing a domestic order through an international location when a suitable in-market location exists.

It does not replace tax, customs, product compliance, or shipping configuration. Confirm the wider market setup before relying on this rule as an operational control.

### Ship from the closest location

This rule prioritizes straight-line proximity to the shipping address. Shopify notes that straight-line distance is not driving distance, so it may not always select the route a human expects.

Use it late as a tie-breaker when closer generally means faster or cheaper. Using it alone can prefer two nearby parcels over one slightly more distant parcel. That tradeoff may be correct, but it should be deliberate.

## Add ranked locations when roles differ

Use ranked locations when some facilities should normally win over others. A common arrangement is:

1. primary ecommerce warehouse
2. secondary warehouses or a 3PL
3. retail stores that can help during exceptions

Locations in the same group share the same rank. Put genuinely interchangeable facilities together; separate locations that have different labor, inventory, or carrier constraints.

Shopify's current [routing setup documentation](https://help.shopify.com/en/manual/fulfillment/setup/order-routing/setting-up-order-routing) recommends ranked locations when warehouses should outrank non-warehouse locations, with closest-location routing available later to break ties between equally ranked warehouses.

Do not rank a warehouse first merely because it is large. Confirm it stocks the catalog, supports the destination, can meet the promise, and has reliable available inventory.

## Model the rule order with real baskets

Before saving a new strategy, build a small test table from actual order patterns:

| Basket | Customer | Stock situation | Expected location | Reason |
|---|---|---|---|---|
| One best seller | Near Store A | Warehouse and Store A both stocked | Warehouse or Store A | Depends on warehouse-first policy |
| Three-item order | Near Store A | Warehouse has all; Store A has two | Warehouse | Avoid split |
| Domestic order | Market A | Market A and B stocked | Market A location | Stay in market |
| Warehouse stockout | Near Store A | Store A has all units | Store A | Valid fallback |
| No location complete | Mixed stock | Two parcels required | Lowest-cost sensible split | Document exception |

For each basket, walk through the rules from top to bottom. If the result surprises you on paper, it will surprise the fulfillment team in production.

Use available inventory at the time of the order, not today's quantity, when investigating a historical assignment. The [inventory states guide](/blog/shopify-inventory-states-explained) explains why a location can have units on hand but still have too little available stock to win routing.

## Roll out without losing the baseline

Capture the current rule order and a week or two of operating measures before changing anything:

- percentage of orders split into multiple fulfillments
- manual location changes
- postage and packaging cost per order
- orders assigned to retail stores
- late handoffs by location
- transfers created to rescue open orders
- customer contacts caused by separate parcels

Then:

1. correct location, inventory, profile, and address errors
2. write the target routing objective
3. configure the smallest rule set that expresses it
4. test representative baskets
5. save the configuration and record the change time
6. watch new orders closely through at least one ordinary operating cycle
7. compare the same measures with the baseline

Change one major routing idea at a time. If you simultaneously reorder rules, activate new locations, and alter shipping profiles, you will not know which change caused an unexpected assignment.

## Troubleshoot an unexpected location in order

When Shopify selects the “wrong” location, check the inputs before overriding the result:

1. **Was the location enabled for online fulfillment?** Disabled locations are excluded.
2. **Was its address verified?** Shopify says closest-location routing skips a location whose address cannot be used for the distance calculation.
3. **Was the variant available when the order was placed?** Current stock can differ from the decision-time stock.
4. **Did the shipping profile and active zone cover the product and destination?** An ineligible location cannot win.
5. **Did an earlier rule eliminate the expected location?** Read the strategy from top to bottom.
6. **Were equally ranked locations left tied?** Shopify can fall back to the older location when the strategy does not break the tie.
7. **Did settings change after the order arrived?** Compare the order time with the configuration change log.

Order routing applies only when the store has at least two fulfillment locations. It also does not prevent every oversell. Shopify documents cases where an order can be assigned to a location without enough inventory so the sale is not lost; review out-of-stock policy and inventory accuracy rather than assuming routing is a stock-control system.

## Handle exceptions without hiding them

For an unfulfilled order, Shopify supports changing the fulfillment location when stock, cost, or delivery needs require it. Use that override for a real exception, then classify why it happened:

- inventory inaccurate
- location temporarily closed or over capacity
- shipping service unavailable
- special handling requirement
- customer deadline
- routing rule design
- product-location setup error

If manual reassignments repeat for the same reason, change the configuration or upstream process. The [inventory transfer workflow](/blog/shopify-inventory-transfer-workflow) is safer when stock must physically move; simply assigning an order to a different location does not move the units.

After assignment, the [fulfillment checklist](/blog/shopify-order-fulfillment-checklist) keeps the selected location, parcel, tracking, and customer notification aligned.

## Review routing monthly and after network changes

Audit routing after adding a location, changing a 3PL, opening a market, moving inventory, or changing shipping profiles. Otherwise, review monthly:

- Are the rules still in the intended order?
- Are inactive or storage-only locations excluded?
- Are addresses and shipping zones current?
- Which SKUs create the most splits?
- Which locations receive the most manual overrides?
- Did a lower parcel count increase distance or lateness?
- Does any retail location need a protected inventory buffer?

Start with the last ten manually reassigned orders. For each one, reconstruct the inputs at order time and decide whether the exception came from bad data, a temporary constraint, or the routing strategy itself. Fix the repeated cause before adding another rule.
