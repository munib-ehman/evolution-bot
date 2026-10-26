---
title: How to brief an AI product catalog audit without changing your store
description: Specify a read-only product catalog audit with evidence, variant-level checks and an actionable spreadsheet instead of automatic edits.
slug: ai-product-catalog-audit
date: 2026-10-26
---
A product catalog audit should leave you with a short, reliable list of issues to review. It should not quietly rewrite descriptions or fill missing specifications with plausible guesses. That distinction makes the task easier to delegate to an AI agent and easier to evaluate afterward.

Use a small export first. A representative sample should include simple products, products with variants and at least one item whose information is incomplete. Keep an untouched copy of the input.

## Choose checks that have definite answers

Separate completeness from correctness. A material field can be populated and still contain the wrong material. Checking whether it is blank is a different task from verifying it against a supplier document.

For an illustrative pilot, choose three checks: missing care instructions, inconsistent dimensions across approved sources and duplicate identifiers. Define which fields matter for each product type. A downloadable product does not need physical shipping dimensions.

Do not make the agent infer every exception from context. Give it a short list of exemptions and ask it to flag unfamiliar cases for review.

## Specify one row per finding

Request a spreadsheet with these columns:

- Product reference and variant reference, where applicable.
- Check performed and observed value.
- Expected rule or approved source.
- Evidence link or document location.
- Suggested next step and review status.

Keep a blank value distinct from an unknown value. If two sources disagree, preserve both and mark the conflict. A confident replacement without evidence is not a completed audit.

## Keep audit output separate from import files

An issue spreadsheet is not automatically safe to upload back into your store. Shopify's [CSV documentation](https://help.shopify.com/en/manual/products/import-export/using-csv?locale=en_GB) explains that blank fields can overwrite existing values when matching products are overwritten. Its [import instructions](https://help.shopify.com/en/manual/products/import-export/import-products) also describe formatting and image-link risks.

For the initial task, explicitly exclude imports and live edits. If you later want changes applied, create a separate reviewed change list and backup plan. Do not reuse the audit spreadsheet as an import merely because both files end in CSV.

## Test whether the audit finds real problems

Create a private test copy containing a few known issues. Include one missing field, one conflicting source and one legitimate exemption. Ask the builder to process it without seeing your answer key.

Measure false alarms as well as detected issues. Then inspect a few rows that were not flagged. Otherwise, an agent that reports only the easiest problem can appear more reliable than it is.

A useful handoff ends with actionable findings, not a catalog quality score alone. For help turning the scope into a concise public brief, see [how to write an agent request](/guides/write-an-ai-agent-request).
