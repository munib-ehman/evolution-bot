---
title: Brief an AI price-monitoring agent to compare like with like
description: Specify product matches, variants, currency and evidence so a competitor price report flags real changes instead of misleading differences.
slug: ai-competitor-price-monitoring
date: 2026-10-28
---
A useful competitor price report answers a narrow question: did the public offer for a genuinely comparable item change? A page containing a lower number is not enough. It might show a smaller pack, a different size, a subscription price or a crossed-out reference price.

The first outcome should be an evidence-backed change list for human review. Automatic repricing is a separate decision with commercial consequences, not a necessary part of monitoring.

## Approve the comparison list

Start with perhaps ten products and an agreed public source for each. Record the exact variant, pack quantity, condition, market and currency. For a direct match, use a reliable shared product identifier where available. For a substitute, explain the comparison and label it as a substitute rather than an identical item.

The owner should approve the list before recurring checks begin. Otherwise the agent can appear accurate while consistently comparing the wrong products.

## Define which price matters

Ask for the currently purchasable one-time price, and record subscription or member pricing separately. Keep shipping and tax treatment explicit. If the final delivered cost cannot be established without entering personal information or completing checkout, label it unknown.

Shopify's [product pricing documentation](https://help.shopify.com/en/manual/products/details/product-details-page/) distinguishes the selling price from a compare-at price. Its [local-pricing guidance](https://help.shopify.com/en/manual/international/pricing) also explains market-specific prices. A monitor must retain those distinctions rather than treating every visible number as the same offer.

## Separate a price change from a failed observation

Use statuses such as unchanged, changed, unavailable and needs review. A blocked page, login wall or inaccessible variant is not evidence of a price increase. Do not bypass access restrictions, create accounts or solve challenges simply to complete a row.

Save the checked URL, timestamp, selected options and a brief evidence excerpt or permitted screenshot. Store the previous valid observation separately. A missing observation must not overwrite the last known price with zero.

For example, a hypothetical two-pack changes from $30 to $28 while a single item remains $16. Reporting “price fell from $30 to $16” would mix units and invent a discount. A unit-price column helps a reviewer catch that error.

## Set a sensible alert rule

Ask for one digest at the agreed interval, with a separate urgent alert only for a clearly defined event. Do not send an alert for every page-load failure or repeat the same unchanged discrepancy indefinitely. Respect the source's permitted access methods and avoid unnecessary polling.

Accept the pilot only after manually checking several product matches, one genuine change and one unavailable case. Require every reported change to have comparable before-and-after evidence. The final report can support a pricing discussion, but it should not claim competitor intent, sales volume or profitability. Those facts are not established by a public product page. See the [sourced comparison guide](/guides/ai-supplier-comparison-brief) for a related approach to keeping observations separate from recommendations.
