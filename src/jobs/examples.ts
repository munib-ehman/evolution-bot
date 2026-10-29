export const exampleRequests = [
  {
    title: 'Flag stockouts before best sellers run out',
    description: 'Check inventory and recent sales each morning. Send one shortlist of products likely to run out within two weeks, with stock remaining, estimated days left and suggested reorder quantities. Use read-only store access and a supplier lead-time sheet. Do not place orders.',
    frequency: 'Daily', monthly_budget: 80,
  },
  {
    title: 'Answer order-status questions without inbox ping-pong',
    description: 'Read incoming order-status questions, look up the matching order and draft a clear answer using the latest tracking information. Escalate missing parcels, identity mismatches and refund requests. Success means routine questions have an accurate draft ready for approval each day.',
    frequency: 'Daily', monthly_budget: 120,
  },
  {
    title: 'Turn inbound sales leads into a daily qualified shortlist',
    description: 'Review new enquiries from a website form and CRM. Summarize what each prospect needs, check against the supplied qualification criteria and send a prioritized shortlist with a suggested next step. Link to every original enquiry and flag missing information instead of guessing.',
    frequency: 'Daily', monthly_budget: 100,
  },
  {
    title: 'Track competitor prices and flag meaningful changes',
    description: 'Monitor public product pages for a supplied list of 25 competing products. Report price and availability changes with source links and check times. Send an alert only when a price changes by more than five percent. Respect website access rules and never change store prices.',
    frequency: 'Daily', monthly_budget: 60,
  },
  {
    title: 'Reconcile payouts and surface payment mismatches',
    description: 'Compare the monthly store order export with payment-provider payout reports. Deliver a spreadsheet of matched transactions and a separate exception list for missing, duplicated or mismatched amounts. Show source row references so every discrepancy can be checked. No transfers or accounting entries.',
    frequency: 'Monthly', monthly_budget: 90,
  },
  {
    title: 'Turn each new product into an accurate product listing',
    description: 'Use the supplier specification sheet and approved brand guidelines to prepare titles, descriptions, image alt text and a product-data checklist for new items. Return import-ready drafts and flag missing facts. Do not invent materials, certifications or benefits, and keep publication behind approval.',
    frequency: 'Weekly', monthly_budget: 75,
  },
  {
    title: 'Triage return requests and prepare the next step',
    description: 'Read new return enquiries, check order dates against the provided return policy and prepare a case summary with the appropriate response draft. Separate straightforward cases from damaged-item and out-of-policy exceptions. Keep final refund decisions and customer messages with the team.',
    frequency: 'Daily', monthly_budget: 110,
  },
  {
    title: 'Spot delayed shipments and send an exception digest',
    description: 'Compare unfulfilled orders and carrier tracking exports each morning. Highlight orders past the dispatch target and parcels without a recent scan. Deliver an exception digest with order links, the issue and a suggested follow-up, without contacting customers or editing orders automatically.',
    frequency: 'Daily', monthly_budget: 85,
  },
  {
    title: 'Send a weekly sales performance summary',
    description: 'Turn the weekly store and advertising exports into one readable report covering revenue, order count, returns and ad spend. Compare with the previous complete week, explain the calculation behind each number and list the largest changes. Mark unavailable data rather than filling gaps.',
    frequency: 'Weekly', monthly_budget: 50,
  },
  {
    title: 'Turn approved ideas into a weekly social media queue',
    description: 'Use an approved content brief, product facts and brand examples to draft five social posts for the coming week. Include a hook, short caption and proposed image brief for each. Deliver one review document and carry forward feedback; do not publish posts or make unsupported claims.',
    frequency: 'Weekly', monthly_budget: 65,
  },
].map((request, index) => ({ ...request, id: `example-${index + 1}`, business_id: '', requester_name: 'Example brief', status: 'Example', created_at: '', example: true }));
