---
title: Shopify Store Access Audit for Users, Apps, and Collaborators
description: Audit Shopify store access across users, collaborators, apps, and recovery methods. Remove stale access, narrow permissions, and document every owner.
slug: shopify-store-access-security-audit
date: 2026-10-11
---

A Shopify access audit should answer four questions: who can enter the admin, what can each person or app do, why do they still need it, and how would you recover control if the primary login failed?

Run the audit quarterly and whenever an employee, contractor, agency, or critical app relationship changes. For a small store, the first pass can fit in one focused hour if you use a single inventory of users, collaborators, apps, and recovery owners.

This is an operational checklist, not an incident-response substitute. If you see an unfamiliar login, unauthorized payout change, new user, or unexplained app activity, preserve the details and contact Shopify Support through an official channel while you secure the relevant accounts.

## Create one access register

Open a sheet with one row for every human and every app. Use these columns:

- name of user, collaborator, agency, or app
- account type
- business owner inside your company
- purpose
- assigned role or data access
- ability to edit, export, refund, install, bill, or change settings
- last activity or last confirmed use
- two-step authentication status for people, when visible
- review decision: keep, narrow, suspend, or remove
- decision owner and due date

Do not rely on memory. A former freelancer may still look familiar, and an app installed for one campaign may still have customer or order access months later.

## Audit users from the owner account

In Shopify admin, go to **Settings → Users** and review each active person. Confirm identity and current responsibilities with the manager or founder who owns the relationship.

For every user, ask:

1. Does this person still work with the store?
2. Is the account individual, rather than a shared login?
3. Does the assigned role match today's job?
4. Can the person view sensitive customer or financial data they do not need?
5. Can they refund, approve app charges, install apps, or change settings without a business reason?
6. Is there a documented backup when this person is unavailable?

Shopify's [store-permissions reference](https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions) shows that some capabilities are especially broad. For example, the permission to manage and install apps can allow a user to add, access, or delete apps and channels, while app access can also be limited to specific apps. Review the exact current permission descriptions in your admin before changing a role.

Do not solve uncertainty by giving everyone administrator access. Build roles around the task. A fulfillment operator may need orders and inventory but not finance, customer export, or store settings. A marketer may need content, discounts, and reports but not payouts or user management.

Shopify's [custom-role examples](https://help.shopify.com/en/manual/your-account/users/roles/role-examples) illustrate this least-access approach for jobs such as fulfillment, finance, and development. Treat the examples as starting points, then remove permissions the actual workflow does not require.

## Review collaborators as temporary access

Collaborator accounts are for Shopify Partners such as agencies, freelancers, and developers. Filter the Users list by collaborator type and confirm an active project owner for each one.

For every collaborator:

- identify the current scope of work
- compare requested or assigned permissions with that scope
- remove access when the project or support period ends
- rotate the collaborator request code if it was shared beyond the intended partner
- document who can approve a future request

Shopify says collaborators use request codes, can be limited through assigned permissions, and can be removed from the admin. Its current [collaborator-account documentation](https://help.shopify.com/en/manual/your-account/users/security/collaborator-accounts) also says an account that has not logged in for 90 days automatically expires. Expiry is a useful backstop, not a reason to keep a finished relationship active for three months.

When an agency's work continues, grant the narrowest role that completes the engagement. The same boundary should be part of your broader decision about [AI, VA, or agency ownership](/blog/ai-vs-va-vs-agency-ecommerce-operations): one accountable owner, a defined output, and an access end date.

## Verify two-step authentication and recovery

Each person should use their own Shopify account and protect it with two-step authentication. Avoid sending codes through shared chat or storing a password in an onboarding document.

For the store owner and every critical operator, confirm:

- two-step authentication is enabled
- the primary method still works
- a backup method exists where appropriate
- recovery codes are stored somewhere safe and confidential
- recovery does not depend on one employee's phone or inbox
- the store-owner email and its recovery methods are current

Shopify's [recovery-code guide](https://help.shopify.com/en/manual/your-account/logging-in/secure-sign-in/recovery-codes) says each account receives its own one-time recovery codes and recommends storing them safely. Do not paste the codes into the access register. Record only that recovery was tested and who is responsible for maintaining it.

Some organization-wide enforcement features depend on the Shopify plan and user type. Verify what your own Security page supports instead of assuming every store can centrally enforce the same control.

## Inspect login and user-management history

For critical users, review recent access for locations, IP addresses, internet providers, browsers, and operating systems that do not make sense for the person's work.

Shopify's [user activity and login history documentation](https://help.shopify.com/en/manual/your-account/users/security/user-management-activity-log) explains that the user-management log records role and user changes, and that recent login history can help identify access from an unknown location or device.

Review:

- newly created or deleted users
- role changes and newly granted permissions
- unfamiliar recent login sessions
- changes made close to an employee or vendor departure
- access that occurred outside the person's expected work pattern

An unfamiliar location is a signal to investigate, not proof of compromise. Travel, mobile networks, VPNs, and changing IP addresses can create legitimate differences. Ask the user and preserve timestamps before drawing a conclusion.

## Audit every installed app

Go to **Settings → Apps** and add each installed app to the register. Open the app's details rather than judging it by name.

For every app, record:

- the business function it performs
- internal owner
- current plan and billing route
- store areas it can view or edit
- customer or staff data it can access
- recent activity and unused access shown by Shopify
- theme extensions, functions, pixels, or other dependencies
- what stops working if the app is removed
- current decision and next review date

Shopify's current [app-management documentation](https://help.shopify.com/en/manual/apps/managing-apps) says the app details page can show billing, privacy information, permissions, extensions, functions, pixel connections, and recent activity. For third-party apps, Shopify can also identify permissions unused in the last 30 days. “Unused” is a prompt to investigate, not automatic proof that removal is safe; a seasonal app or emergency workflow may be intentionally quiet.

Cross-check access with value. The [Shopify app-stack cost audit](/blog/average-shopify-app-stack-cost-per-month) covers subscription overlap, while the [guide to firing an app](/blog/when-to-fire-shopify-app) covers operational removal. The security audit adds a separate question: is the remaining access proportional to the value and risk of keeping the app?

## Uninstall with a rollback plan

Removing an app can affect theme code, storefront widgets, product data, discount functions, pixels, subscriptions, or workflows outside Shopify. Do not click uninstall merely because the app owner is unclear.

Before removal:

1. identify the internal owner and vendor account
2. export business data the store is entitled and required to retain
3. document theme, function, pixel, workflow, and billing dependencies
4. confirm how off-platform billing is canceled
5. take a tested backup or duplicate where appropriate
6. choose a low-risk change window
7. test the storefront, checkout path, notifications, and affected operations afterward
8. record the result and remaining vendor data-retention steps

If the app is still needed but its access appears too broad, check whether the vendor offers a narrower configuration or whether a replacement can meet the requirement with less access. Do not claim a permission can be reduced unless the app and Shopify actually expose that option.

## Separate ownership from daily use

The person who uses a tool every day is not always the right person to approve its most consequential actions.

Assign named owners for:

- store ownership and account recovery
- user and role administration
- app installation and paid-plan approval
- payout and bank changes
- customer-data exports
- theme publication and checkout changes
- incident coordination

Avoid a single invisible gatekeeper. At least one appropriate backup should know how to recover access and where the vendor, domain, payment, and recovery records live. That backup does not need permanent administrator access if the role can be activated safely when needed.

## Use an offboarding checklist every time

When a person or vendor leaves, complete the access change at the end of their approved work—not at the next quarterly review.

The checklist should cover:

- suspend or remove the Shopify user or collaborator
- transfer ownership of apps, domains, files, automations, and vendor accounts
- remove access to email, password manager, analytics, support, advertising, fulfillment, and shared drives
- rotate credentials or tokens that were genuinely shared
- verify scheduled workflows and billing contacts
- preserve required business records
- review recent user and store activity for unexpected changes
- confirm the departure in the access register

Do not delete evidence of work or access that the business must retain. Follow applicable employment, contract, privacy, tax, and recordkeeping requirements for your jurisdiction.

## The 60-minute audit agenda

Use a timer and work in this order:

### Minutes 0–15: people

- export or list users and collaborators
- identify inactive relationships
- flag administrator and sensitive permissions
- assign every account an internal owner

### Minutes 15–30: authentication and activity

- verify two-step authentication and recovery ownership
- inspect critical-user login history
- review recent user and role changes
- capture anything that needs investigation

### Minutes 30–50: apps

- list installed apps and charges
- review data access, edit access, and recent activity
- mark keep, narrow, investigate, or remove
- identify dependencies before any uninstall

### Minutes 50–60: decisions

- remove clearly stale access
- assign owners and due dates for ambiguous items
- schedule risky changes separately
- set the next quarterly review date

The output should be a shorter, better-owned access list—not merely a completed spreadsheet. Start with the easiest high-confidence action: remove a finished collaborator relationship or suspend a departed user's account. Then work through permissions and app dependencies without trading security for haste.
