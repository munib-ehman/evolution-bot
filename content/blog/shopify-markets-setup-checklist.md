---
title: Shopify Markets Setup Checklist for International Selling
description: Set up Shopify Markets without breaking price, product availability, shipping, language, or duties. Use a controlled checklist for one market at a time.
slug: shopify-markets-setup-checklist
date: 2026-10-23
---

Shopify Markets lets one store present different products, prices, currencies, languages, domains, and tax or duty settings to different groups of customers. That flexibility is useful only when the entire buying path agrees.

The safest rollout is one market at a time: prove that the store can serve the region, define who belongs in the market, inherit defaults deliberately, customize only what the market needs, and test a real product from landing page through refund. Do not activate ten countries because their flags appear in a settings screen.

## Decide whether the market is operationally real

Start with evidence that the store can serve the customer after checkout. For one candidate country or region, document:

- recent sessions, orders, presale questions, or waitlist demand
- products that can legally and practically be sold there
- an accepted payment method and settlement path
- a shipping zone, rate, service, and realistic delivery range
- return instructions and a return address or approved alternative
- customer support language and response window
- tax, duty, customs, product-labeling, and consumer-law review
- contribution after payment, currency, shipping, duty, support, and return costs

Shopify's current [Markets requirements and considerations](https://help.shopify.com/en/manual/markets/getting-started/requirements-and-considerations) say a regional market can be activated only when shipping rates exist for its countries or regions. The same documentation says Shopify Payments or Adyen is required for customers to pay in multiple currencies; with another processor, customers pay in the store's default currency.

Those are platform prerequisites, not proof of a profitable route. A configured market cannot make an unreliable carrier, prohibited product, or uneconomic return disappear.

Build a simple market contribution estimate before launch:

> Market contribution per order = net product revenue - product cost - payment and currency costs - shipping subsidy - expected duty or tax cost paid by the store - expected support and return cost

Use conservative inputs from real quotes and recent orders. Compare that result with the store's normal [true profit per order](/blog/true-profit-per-order-not-just-revenue), not with revenue alone.

## Understand conditions, customizations, and inheritance

Shopify's [Markets concepts guide](https://help.shopify.com/en/manual/markets/getting-started/overview) separates a market into two parts:

- **Conditions** define which customers belong to it, such as a country or region.
- **Customizations** define the experience they receive, including product availability, pricing, currency, theme content, domains, languages, and duties or taxes.

New markets inherit store defaults. Submarkets inherit from parent markets. That is helpful, but it can hide a decision: an inherited setting is still an active setting customers will experience.

Create a control table before changing the admin:

| Area | Inherited value | Market-specific decision | Owner |
|---|---|---|---|
| Countries or regions | None | Included destinations | Operations |
| Catalog | Store default | Products and prices allowed | Merchandising |
| Currency | Store default | Local or market currency | Finance |
| Domain and language | Primary storefront | URL and translated content | Ecommerce |
| Shipping | Existing zones | Services, rates, delivery wording | Operations |
| Duties and taxes | Store default | Display and collection approach | Finance or adviser |

Shopify says market customizations apply when saved, while removing a customization returns the market to its inherited value. Review the inherited result before adding overrides; otherwise several layers can make a price or product appear for reasons the operator does not understand.

## Keep the first catalog narrow

A market catalog controls which products customers can see and the prices they receive. Shopify's current [catalog documentation](https://help.shopify.com/en/manual/markets/customizations/catalogs) says all products are available at default prices unless a catalog changes that result. It also explains that products can be combined across inherited catalogs, with more-specific pricing taking precedence in some configurations.

For a first rollout, include a deliberate set of proven products. Exclude items with:

- uncertain import or product restrictions
- missing customs description, origin, or classification data
- fragile, oversized, hazardous, temperature-sensitive, or expensive return paths
- untranslated safety, compatibility, or sizing information
- margin too thin for the market's full cost
- inventory that cannot be allocated reliably

Use Draft while reviewing a new catalog. Check every included product with Shopify's market view, then test the storefront as a customer in that market. A product also needs the correct sales-channel availability; catalog inclusion alone does not guarantee the full path is ready.

Keep the catalog change connected to the [product release checklist](/blog/shopify-product-catalog-release-checklist). International availability is another release decision, not an afterthought attached to an Active product.

## Price from the market's economics

Local currency improves clarity, but a converted price does not automatically protect margin. Shopify's current [market currency documentation](https://help.shopify.com/en/manual/markets/customizations/local-currencies) distinguishes automatic and manual exchange rates, rounding, catalog adjustments, conversion fees, and refunds in foreign currencies.

Build a pricing sheet with:

- base price and base contribution
- exchange-rate method
- payment and currency-conversion cost
- catalog price adjustment or fixed price
- rounding outcome
- shipping subsidy
- duty or tax amount paid by the store
- expected return and support cost
- final contribution in the payout currency

If manual rates are used, assign an owner and review frequency. If automatic rates are used, model how changes and rounding affect contribution. When the catalog contains a fixed price, confirm which broader adjustment it overrides.

Test discounts as well. A fixed-amount discount created in the store's default currency can be converted at checkout, so the customer-facing value and margin can differ across currencies. Recheck the [pricing and margin math](/blog/how-to-price-products-margin-math) with the market-specific cost stack.

## Treat domains and languages as one customer path

Shopify's [domains and languages guide](https://help.shopify.com/en/manual/markets/customizations/domains-and-languages) covers market-specific domains, subdomains, subfolders, and languages. Choose a structure that the team can maintain, then test how customers and search engines reach it.

Translate the parts that create or prevent an order first:

1. product titles, descriptions, options, sizing, and compatibility
2. shipping, delivery, duty, return, warranty, and cancellation information
3. cart and checkout content
4. order, shipping, delay, return, and refund notifications
5. customer-account and order-status content
6. common support replies

Do not launch a translated landing page into a default-language checkout and support queue without saying what service the customer will receive. The [multilingual support guide](/blog/multilingual-support-small-store) provides a practical review boundary for buying-critical and policy language.

Before activation, confirm redirects, language selectors, canonical behavior, indexed URLs, and analytics labels. Test a direct visit, search result, paid-ad link, and link shared from another market. A visitor should not bounce between currencies or languages while moving through the same purchase.

## Make shipping and duties agree with the promise

Markets and shipping configuration are connected but not interchangeable. For every included destination, test:

- one ordinary cart
- one heavy or oversized cart
- a cart near each free-shipping or rate threshold
- a product excluded from the market
- a remote or high-cost address
- the fastest and slowest offered service
- duty and tax wording at checkout
- delivery estimates with the store's handling time included

Use the [Shopify shipping-rate framework](/blog/shopify-shipping-rates-free-flat-calculated) to compare what the customer pays with what the store expects to spend. If duties are collected at checkout, verify the eligible products, destinations, carrier path, and customer wording. If duties are not collected, explain the likely responsibility without making a promise the store cannot support.

Tax and duty obligations depend on the products, business, destination, and transaction. Shopify settings implement a chosen approach; they do not decide the store's legal obligations. Get appropriate professional advice before relying on a new configuration.

## Run one end-to-end market test

Use a representative product and address, then record evidence for each step:

1. Customer matches the intended market.
2. URL, language, content, currency, and product availability are correct.
3. Product price and discount match the approved sheet.
4. Cart keeps the same market experience.
5. Checkout shows the intended payment, shipping, delivery, tax, and duty result.
6. The order records the expected market, currency, amounts, and fulfillment location.
7. Notifications use the correct language and amounts.
8. The shipping label and customs information match the parcel.
9. The payout and fees reconcile to the pricing model.
10. A test cancellation or refund behaves as expected in the customer's currency.

Test on mobile and desktop. Use an approved test method and never create a customs declaration for a parcel that will not follow the documented path.

## Use an activation gate

- [ ] Demand and full contribution are documented
- [ ] Products can be sold and shipped to every included destination
- [ ] Market conditions include only intended customers
- [ ] Inherited settings and every override are reviewed
- [ ] Catalog products, prices, and channel availability are verified
- [ ] Currency method, conversion cost, rounding, and refunds are understood
- [ ] Domain, language, notifications, and support path are tested
- [ ] Shipping rates and delivery wording pass representative carts
- [ ] Tax, duty, customs, and product obligations have an owner
- [ ] End-to-end order and refund tests pass
- [ ] Monitoring and rollback owners are named

Activate one market, watch its first orders, and review contribution, payment failures, address issues, shipping adjustments, returns, and support questions. Add the next market only after the first one is an operating system rather than a collection of settings.
