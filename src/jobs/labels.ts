export const formatMonthlyBudget = (amount: number | null) => amount === null ? 'Budget not set' : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)}/month`;

const agentTypes: [RegExp, string][] = [
  [/\b(job search|job listings?|job opportunities|(shortlist|search|find|matching)\b.*\b(jobs?|internships?)|(jobs?|internships?)\b.*\b(shortlist|search|find|matching))\b/i, 'Job search agent'],
  [/\b(customer support|customer service|support tickets?|order[- ]status|helpdesk)\b/i, 'Customer support agent'],
  [/\b(inventory|stock levels?|stock report|stockouts?|restock|reorder)\b/i, 'Inventory agent'],
  [/\b(lead generation|sales leads?|prospecting|sales outreach)\b/i, 'Sales agent'],
  [/\b(social media|marketing|ad campaigns?|seo)\b/i, 'Marketing agent'],
  [/\b(product listings?|product catalog)\b/i, 'Catalog agent'],
  [/\b(return requests?|returns handling)\b/i, 'Returns agent'],
  [/\b(shipments?|fulfillment|dispatch)\b/i, 'Fulfillment agent'],
  [/\b(content writing|copywriting|blog posts?|newsletters?|product descriptions?)\b/i, 'Writing agent'],
  [/\b(bookkeeping|invoices?|accounting|expense reports?|reconciliation|reconcile|payouts?)\b/i, 'Finance agent'],
  [/\b(data analysis|analytics|data reports?|spreadsheets?|sales performance)\b/i, 'Data agent'],
  [/\b(research|competitor monitoring|competitor prices?|price monitoring)\b/i, 'Research agent'],
];

export function agentTypeForJob(title: string) {
  return agentTypes.find(([pattern]) => pattern.test(title))?.[1] || 'Custom AI agent';
}

export function requestSummary(description: string, limit = 180) {
  const text = description.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const excerpt = text.slice(0, limit - 1);
  const boundary = excerpt.lastIndexOf(' ');
  return `${excerpt.slice(0, boundary > limit / 2 ? boundary : excerpt.length).trimEnd()}…`;
}
