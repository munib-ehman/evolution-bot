---
title: Google Merchant Center Rejections: Common Fixes for Shopify Stores
description: Fix common Google Merchant Center product rejections by tracing the exact issue, correcting Shopify data, matching landing pages, and reviewing safely.
slug: google-merchant-center-rejections-common-fixes
date: 2026-08-27
---

When Google Merchant Center rejects a Shopify product, fix the named issue at its source instead of changing random feed fields. First identify whether the problem affects one item or the whole account, then compare Shopify's product data with the landing page, checkout, store policies, and Merchant Center settings.

Most item-level problems fall into a few buckets: missing attributes, invalid identifiers, price or availability mismatches, image violations, unreachable landing pages, or policy issues. Account suspensions are broader and need a full store review before you request another review.

## Start in “Needs attention,” not with a resync

Google's current [product status documentation](https://support.google.com/merchants/answer/12488713) distinguishes products that are under review, limited, not approved, or not showing. A not-approved item can have a policy disapproval, a data-quality disapproval, or both.

For each issue, record:

- the exact issue name
- affected product IDs and countries
- affected marketing methods, such as free listings or ads
- whether it is item-level or account-level
- Google's example products or detected values
- the source that owns the field: Shopify, an app, a supplemental source, or Merchant Center

Do not start by disconnecting the Google channel or deleting the feed. That can remove useful diagnostics without fixing the source data.

In Shopify, the Google & YouTube channel shows product sync errors on the relevant product. Shopify's current [channel setup guide](https://help.shopify.com/en/manual/online-sales-channels/marketplaces/google/getting-setup/connect) lists examples including missing descriptions or images, unavailable landing pages, missing GTIN or MPN values, promotional image overlays, and excessive capitalization.

## Fix price and availability mismatches at the source

Google regularly compares submitted product data with the product page. Its [approval guidance](https://support.google.com/merchants/answer/14999713) says price and availability should stay synchronized and recommends structured data to help Google interpret the landing page.

Check the affected variant, not just the parent product:

1. Open the exact URL submitted for the rejected item.
2. Confirm the page loads without a login, password, geolocation loop, or server error.
3. Select the same variant represented by the product ID.
4. Compare price, sale price, currency, and availability with Merchant Center.
5. Add the item to cart and confirm checkout shows a purchasable item at the expected price.
6. Check whether a currency, bundle, subscription, or discount app rewrites the visible value.

Google's [product data specification](https://support.google.com/merchants/answer/7052112) requires submitted availability to match the landing and checkout pages. A product marked `in_stock` in the feed but unavailable for purchase is not fixed by another sync; update inventory or the product's published state.

Automatic item updates can reduce temporary price and availability mismatches, but Google explicitly says merchants still need to resubmit accurate product data. Treat automatic correction as a safety net, not the owner of your catalog.

If inventory accuracy is the underlying problem, repair the workflow described in [inventory planning for solo store owners](/blog/inventory-planning-solo-store-owners) rather than repeatedly approving stale stock.

## Use real identifiers—never a guessed GTIN

For products with manufacturer-assigned identifiers, submit the correct GTIN and brand. For custom goods without a GTIN, use the fields and identifier settings appropriate to that product; do not copy a barcode from a similar item.

Shopify notes in its [Google channel requirements](https://help.shopify.com/en/manual/online-sales-channels/google/requirements) that most products need a Google product category and unique product identifiers, with additional requirements for certain categories. Variants also need their own correct attributes.

When Google flags an incorrect identifier, check:

- the barcode in Shopify matches the physical packaging
- each variant has the right identifier
- brand and MPN refer to the same product
- custom products are not pretending to have manufacturer identifiers
- identifiers are not reused across different variants

If the packaging and supplier data disagree, stop and verify with the manufacturer or brand owner. A plausible-looking number is not evidence.

## Repair images and product copy without creating a new problem

The main image should show the product clearly. Remove promotional text, watermarks, borders, placeholder graphics, and “sale” badges from the image sent to Google. Also confirm the image URL loads and is not blocked.

For titles and descriptions:

- name the actual product
- include variant details that distinguish the item
- remove all-caps styling and promotional language
- avoid unsupported claims
- keep the landing-page product consistent with the submitted item

This is not an invitation to keyword-stuff. A [specific product description](/blog/product-descriptions-that-rank-and-convert) can help Google understand the item while still answering customer questions. Fixing thin or misleading copy also improves the product page itself, not just the feed.

## Check the destination like a first-time buyer

An acceptable feed cannot rescue a broken store. Test the landing page on mobile and desktop, in a private browser, and from the market you target.

Verify that customers can:

- open the product URL
- understand what is being sold
- see the price and availability
- add the exact item to cart
- find shipping information before purchase
- find clear return, refund, and cancellation policies
- identify the business and reach support
- complete checkout securely

Google's current [editorial and professional requirements](https://support.google.com/merchants/answer/6150244) identify broken or placeholder pages, insufficient contact information, and missing or incomplete return and refund information as problems. Its [misrepresentation policy](https://support.google.com/merchants/answer/6150127) also requires offers and business information to be accurate and clear.

Do not add a policy page only for Google's crawler. Make it easy for customers to find and make sure your actual support and refund behavior matches the policy. The same clarity addresses several [product-page mistakes that kill conversions](/blog/product-page-mistakes-that-kill-conversions).

## Treat shipping and tax as customer-visible data

Compare Merchant Center settings with what a customer sees at checkout for the target country. Pay attention to:

- countries served
- handling and transit times
- free-shipping thresholds
- carrier-calculated or table rates
- remote-area or oversized-item charges
- tax inclusion where applicable

If Shopify automatically syncs shipping, verify that your configuration is supported. If you manage shipping manually in Merchant Center, set a calendar reminder to review it when Shopify rates change. The feed, landing page, and checkout should not promise three different things.

## Item rejection and account suspension need different responses

For an item-level data error, correct the owning field and let the updated product sync. Keep notes so you can verify the changed value after processing.

For an account-level policy issue:

1. Read the full issue description and every example Google provides.
2. Review the whole website, business identity, policies, product catalog, and Merchant Center settings.
3. Fix the underlying pattern, not only the example URLs.
4. Confirm the live changes in a private browser.
5. Request review only after the fixes are complete.

Google's [data-quality enforcement guidance](https://support.google.com/merchants/answer/13693497) explains that repeated unsuccessful reviews can lead to a cooldown when the review button is unavailable. That is why an incomplete appeal is costly. If the account issue is unclear or involves regulated products, use qualified platform or legal support rather than guessing.

## A practical rejection worksheet

Use one row per issue:

| Issue | Scope | Affected IDs | Source owner | Live-page check | Fix made | Reprocessed | Result |
|---|---|---|---|---|---|---|---|
| Example: price mismatch | Item | SKU-RED-M | Shopify variant | Page $29 / feed $31 | Updated variant price | Pending | Pending |

Work in this order:

1. account-level and policy issues
2. unreachable destinations and checkout failures
3. price and availability mismatches
4. missing or invalid identifiers
5. images, titles, descriptions, and category attributes
6. warnings that limit reach but do not reject the item

After each fix, confirm the exact data that Merchant Center received. A green status in Shopify does not replace checking Google, and a manual edit in Merchant Center may be overwritten by the next Shopify sync.

Finish with the broader [Shopify SEO checklist](/blog/shopify-seo-checklist-cant-afford-agency): working product pages, specific metadata, valid internal links, and accessible images help both customers and product systems understand the catalog.

The next action is to export or copy every issue from “Needs attention” into the worksheet, group affected IDs by root cause, and fix the highest-scope cause first. One verified root-cause change is better than ten blind resyncs.
