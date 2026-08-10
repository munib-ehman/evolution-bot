# Evolution Role-First Product Roadmap

## Product decision

Evolution is transitioning from selling individual skills to selling complete AI roles for Shopify merchants. A role is the customer-facing product; skills are the workflows and tools used internally by that role.

The first three roles, in delivery order, are:

1. Marketing Manager
2. Customer Success Manager
3. SEO Manager

Only one role is built at a time. Each role must work end to end against real Shopify data, produce useful output, respect merchant approvals, handle failures, and pass its acceptance checks before work begins on the next role.

Product and Operations Managers remain future roles and are not part of this first delivery cycle.

## Shared product model

Each role should have:

- A clear job description and promised business outcome.
- A dedicated home/dashboard showing priorities, recent work, results, and pending approvals.
- Several workflows presented as responsibilities, not as disconnected skill buttons.
- Access only to the Shopify data and external services required for its job.
- Approval-gated actions with before/after previews, history, failure states, and eligible undo.
- Proactive recommendations based on store data, plus an on-demand conversational interface.
- Outcome reporting so the merchant can see what the role accomplished.

## Day 1: Marketing Manager

### Customer promise

The Marketing Manager finds recoverable revenue and prepares targeted campaigns that the merchant can review and launch.

### Initial responsibilities

1. Abandoned Cart Recovery
2. Win-back Campaigns
3. Email Marketing

### MVP workflow

1. Read the connected store's abandoned checkouts and customer/order history.
2. Calculate opportunity size and rank the most valuable audience or campaign.
3. Recommend a campaign with audience, timing, offer, subject line, and message copy.
4. Show the recommendation as a reviewable campaign draft.
5. Require explicit merchant approval before any external communication or store change.
6. Record the campaign/action and show its status and measurable result.

### Existing foundations to reuse

- Cart recovery reporting and recovery-message drafting.
- Retention segmentation and win-back drafting.
- Shopify-grounded agent chat.
- Discount proposals and approval cards.
- Action history, metrics, and undo/deactivation where eligible.

### Required implementation work

- Replace the disconnected recovery/retention skill presentation with a Marketing Manager surface.
- Create one unified marketing overview with revenue opportunity, recommended next action, drafts, approvals, and history.
- Standardize a campaign draft model: campaign type, audience, channel, offer, schedule, copy, status, and attribution fields.
- Connect abandoned-cart and lapsed-customer analysis to campaign creation.
- Define the actual email delivery integration. Until it exists, label outputs as drafts and never imply that an email was sent.
- Add loading, empty, disconnected-store, insufficient-data, approval, success, partial-failure, and retry states.
- Add event tracking for draft created, approved, launched/exported, and outcome measured.

### Acceptance criteria

- A connected merchant can open Marketing Manager and immediately see the best available marketing opportunity.
- The role can generate an abandoned-cart campaign from real checkout data.
- The role can generate a win-back campaign from real customer/order data.
- Every campaign clearly identifies its audience, expected opportunity, proposed offer, timing, and copy.
- No email or Shopify mutation occurs without explicit merchant approval.
- The UI accurately distinguishes a draft, an approved action, and a genuinely launched campaign.
- Campaign history survives refresh and is owner-scoped.
- Failures are visible and retryable without creating duplicate actions.
- Relevant automated tests and a manual connected-store happy-path check pass.

### Important Day 1 scope boundary

If a production email provider and the required consent/suppression data are not available, Day 1 delivers fully usable campaign analysis and approval-ready drafts, but not email sending. Sending becomes complete only after provider integration, unsubscribe handling, suppression checks, and delivery-event tracking are verified.

## Day 2: Customer Success Manager

### Customer promise

The Customer Success Manager protects customer relationships, helps resolve customer issues, generates reviews, and identifies customers at risk of not returning.

### Initial responsibilities

1. Customer Support
2. Review Generation
3. Customer Retention

### Planned scope

- A prioritized customer-success inbox or work queue.
- Shopify order and customer context for each case.
- Approval-ready support replies rather than pretending a reply was sent.
- Post-purchase review-request audience selection and message drafts.
- At-risk and high-value customer segments with recommended retention actions.
- Resolution, response, review, and repeat-purchase outcome tracking.

### Dependency warning

Real customer support requires a support-channel integration such as email/helpdesk/chat. Without one, this role is limited to Shopify-derived customer insights and reply/review drafts.

## Day 3: SEO Manager

### Customer promise

The SEO Manager continuously finds and prepares improvements that help products become discoverable in search engines and AI answer engines.

### Initial responsibilities

1. Product SEO
2. AI/GEO Optimization

### Planned scope

- Audit product titles, descriptions, handles, meta titles/descriptions, image alt text, structured content, and internal discoverability signals.
- Prioritize fixes by expected impact and confidence.
- Prepare before/after product updates through the existing approval system.
- Add AI/GEO checks for clear product facts, entity consistency, answer-ready copy, trust information, and machine-readable product data.
- Track approved fixes and measure available search/discovery outcomes.

### Dependency warning

Traffic, query, impression, and ranking measurement requires search analytics integration (for example, Google Search Console). Without it, Evolution can measure implementation coverage and Shopify-side outcomes but must not claim ranking improvements.

## Delivery sequence for each role

Use the same gate for every role:

1. Confirm the role promise and strict MVP boundary.
2. Inventory reusable code and missing integrations.
3. Define data contracts and permissions.
4. Build the end-to-end happy path.
5. Add approvals, persistence, error handling, and idempotency.
6. Add outcome tracking and role-specific dashboard states.
7. Test with realistic fixtures and a connected development store.
8. Update customer-facing positioning only when the product behavior supports the claim.
9. Mark the role working before starting the next role.

## Current execution status

- Marketing Manager: in progress. Abandoned-cart recovery, win-back campaigns, and consent-safe one-time campaigns now have draft, approval, delivery, unsubscribe, and event-tracking paths. Unified history, proactive recommendations, attribution, and connected-store acceptance testing remain.
- Customer Success Manager: queued after Marketing Manager is working.
- SEO Manager: queued after Customer Success Manager is working.
- Product Manager: deferred.
- Operations Manager: deferred.

## Confirmed Marketing Manager implementation decisions

These decisions were confirmed before implementation:

- Initial merchant markets: United States, Canada, and Gulf countries.
- Email delivery during beta: Evolution-managed Resend integration for testing and validation only. The delivery layer must remain provider-agnostic because the commercial sending model can change later.
- Email economics: Evolution must not silently absorb unbounded sending costs. Beta usage will be measured so the production model can use a bundled allowance, paid overage, merchant-connected provider, or Shopify-native delivery where an appropriate supported integration exists.
- Beta allowance: target 300–400 sent emails per merchant per month. Enforcement must use an explicit configured limit rather than copy-dependent behavior.
- Product experience: redesign the current skill-first app into a role-first Marketing Manager workspace.
- Interaction model: every important Marketing Manager operation must be available through natural-language chat as well as visible UI controls. Chat and buttons must call the same typed tools and policy-enforced backend operations; chat must not bypass approvals or sending safeguards.
- UX priority: chat is the primary flexible control surface, while the workspace makes state, opportunities, drafts, automations, approvals, usage, and results immediately understandable.

### Chat-control principle

The merchant should be able to request actions such as:

- "Show me this week's best marketing opportunity."
- "Create an abandoned-checkout sequence without a discount."
- "Build a win-back campaign for customers inactive for 90 days."
- "Change the second email to 10% off and send me a test."
- "Schedule this for Tuesday at 10 AM."
- "Pause cart recovery."
- "How much revenue did the campaign recover?"

The agent may analyze, explain, and draft autonomously. Sending, scheduling a one-time campaign, enabling an automation, or increasing an approved incentive must produce a structured confirmation/approval card. A plain chat response can never count as proof that an external action occurred.
