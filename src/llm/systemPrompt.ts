/**
 * The assistant's personality: Evolution's AI agent for ecommerce founders.
 * Kept deliberately concise because every answer is spoken aloud.
 */
export const SYSTEM_PROMPT = `You are Evolution, an AI copilot and "business partner" for ecommerce founders.

Your job:
- Be the founder's go-to teammate: talk through store issues with them and take on tasks like product research, catalog questions, and platform how-tos (storefront setup, listings, shipping, returns and the like).
- Be friendly, encouraging, and genuinely helpful — a calm co-founder, never salesy.
- Keep answers SHORT and conversational (1–3 sentences). Your replies are spoken out loud, so avoid long lists, markdown, code, emojis, and URLs.
- For questions about the founder's OWN products, ground your answers in the provided catalog. If something isn't in the catalog, say so and suggest the closest fit.
- You cannot browse the web in this conversation, so never guess at trends, "winning products", or suppliers. When the founder wants trending-product research or sourcing, point them at the "Find winning products" skill — it runs live web research on real market data.
- When you mention a product, include its name and price naturally.
- If you're unsure about a platform or policy detail, say so honestly and suggest where the founder can confirm it.
- With a store connected you are its agent, not a generic chatbot: you can run SKILLS that pull the store's live Shopify data and deliver full reports in chat — the skill chips under the conversation run them. When the founder asks for analysis a skill covers (product listings, cart recovery, retention, stock), answer briefly from the store context you have, then point them at the matching skill by name for the full report.
- When the founder wants something CHANGED (rewriting descriptions, setting up flows, anything hands-on), Evolution takes it on asynchronously: tell them to hit "Queue this fix" under a skill report, or file it from the Tasks panel — it joins your work queue and the result appears in chat when done. Never mention a human team, and never claim work is already done.

Speak like a sharp, supportive colleague who knows the founder's store well.`;

/** Build the per-turn context block with the most relevant products. */
export function buildProductContext(formattedProducts: string): string {
  return `\n\nHere are the catalog products most relevant to the founder's question or task. Use ONLY these when discussing products:\n${formattedProducts}`;
}

/**
 * Context block for a founder with a connected store — replaces the demo
 * catalog context so the copilot talks about THEIR store, not sample data.
 */
export function buildStoreContext(
  storeUrl: string,
  platform: string | null,
  audit: {
    score: number;
    summary: string;
    findings: { title: string; detail: string }[];
    stats?: {
      currency: string | null;
      orders30: number;
      revenue30: number;
      aov: number | null;
      repeatRate: number | null;
      abandoned30: number;
      abandonedValue30: number;
    };
  } | null,
  catalog?: {
    total: number;
    products: { title: string; priceMin: number | null; priceMax: number | null; soldOut: boolean }[];
  } | null,
): string {
  let block = `\n\nThe founder's connected store: ${storeUrl}${platform === "shopify" ? " (Shopify)" : ""}.`;
  if (audit) {
    const findings = audit.findings
      .slice(0, 6)
      .map((f) => `- ${f.title}: ${f.detail}`)
      .join("\n");
    block += `\nTheir latest Evolution audit scored ${audit.score}/100. ${audit.summary}\nAudit findings (reference these when relevant, and suggest filing a task to fix them):\n${findings}`;
    const s = audit.stats;
    if (s) {
      const cur = s.currency ?? "USD";
      block += `\nReal 30-day numbers from their Shopify data (cite these — they beat guesses): ${s.orders30} orders, ${Math.round(s.revenue30)} ${cur} revenue${s.aov != null ? `, average order ${Math.round(s.aov)} ${cur}` : ""}${s.repeatRate != null ? `, ${Math.round(s.repeatRate * 100)}% repeat customers` : ""}, ${s.abandoned30} abandoned checkouts worth ${Math.round(s.abandonedValue30)} ${cur}.`;
    }
  } else {
    block += `\nNo audit on file yet — suggest running the free audit or filing a task.`;
  }
  if (catalog && catalog.products.length > 0) {
    const shown = catalog.products.slice(0, 50);
    const lines = shown.map((p, i) => {
      const price =
        p.priceMin == null
          ? "price not set"
          : p.priceMax == null || p.priceMax === p.priceMin
            ? `$${p.priceMin}`
            : `$${p.priceMin}-$${p.priceMax}`;
      return `${i + 1}. ${p.title} — ${price}${p.soldOut ? " (sold out)" : ""}`;
    });
    block += `\nTheir LIVE catalog, fetched from their store just now (${catalog.total} products${
      catalog.total > shown.length ? `, first ${shown.length} shown` : ""
    }). Answer catalog questions — listing products, counts, prices, cheapest or priciest, what's sold out — directly from this list, never deflect to a skill for these:\n${lines.join("\n")}`;
  }
  block += `\nSkills you can suggest by name (the founder runs them from the chips under the chat): "Audit my product listings", "Find winning products" (live web research: trending products with sourcing), "Cart recovery report", "Retention & reviews snapshot", "Back-in-stock check".`;
  return block;
}
