/**
 * Mock "brain" — rule-based answers built entirely from products.json.
 *
 * This is the DEFAULT path when no LLM key is configured. It lets the whole app
 * (3D avatar + STT + TTS + lip-sync) run and demo at literally zero cost and
 * zero signups. It's intentionally simple keyword logic, not an LLM.
 */
import type { Product } from "../types";
import { retrieveRelevant, scoreProducts } from "./retrieval";

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Extract a budget like "$50", "under 50", "less than 40 dollars". */
function extractBudget(text: string): number | null {
  const m = text.match(/(?:under|below|less than|max|up to|budget of|around|about)?\s*\$?\s*(\d{1,4})(?:\s*(?:dollars|bucks|\$))?/i);
  if (m && /(under|below|less than|max|up to|budget|cheap|around|about|\$)/i.test(text)) {
    return Number(m[1]);
  }
  return null;
}

export function mockReply(userText: string, products: Product[]): string {
  const text = userText.toLowerCase().trim();

  // Greetings
  if (/^(hi|hey|hello|yo|howdy|good (morning|afternoon|evening))\b/.test(text) || text === "hi") {
    return "Hey there! Evolution here, your AI copilot. What can I dig into for you today?";
  }

  // Thanks / goodbye
  if (/\b(thanks|thank you|cheers|appreciate)\b/.test(text)) {
    return "Anytime! Happy to help you find the perfect thing. Anything else you're curious about?";
  }
  if (/\b(bye|goodbye|see you|later)\b/.test(text)) {
    return "Take care! Come back anytime you need a hand.";
  }

  // Who/what are you
  if (/\b(who are you|what are you|your name)\b/.test(text)) {
    return "I'm Evolution, your AI copilot for ecommerce. I can research your catalog, compare products, and answer questions about your store.";
  }
  if (/\b(help|what can you do|how does this work)\b/.test(text)) {
    return "I can research products in your catalog, compare options, and answer store questions. Try something like 'headphones for the gym' or 'what do we have under 50 dollars'.";
  }

  // Store policy (generic, since there's no real backend)
  if (/\b(ship|shipping|delivery|deliver)\b/.test(text)) {
    return "We aim to ship within a couple of business days, and you'll get a tracking link by email. Check the store's info page for exact times to your area.";
  }
  if (/\b(return|refund|exchange|warranty)\b/.test(text)) {
    return "Returns are easy — most items can go back within 30 days if they're in good shape. The info page has the full policy.";
  }
  if (/\b(discount|coupon|promo|sale|deal)\b/.test(text)) {
    const cheapest = [...products].sort((a, b) => a.price - b.price)[0];
    return `I don't have a code handy, but great value right now is the ${cheapest.name} at ${money(cheapest.price)}. Want more budget-friendly picks?`;
  }

  // Catalog listing
  if (/\b(what do you (sell|have)|show me|catalog|everything|all products|list)\b/.test(text)) {
    const names = products.slice(0, 6).map((p) => p.name);
    return `We've got things like ${list(names)}. What kind of item are you after?`;
  }

  // Cheapest / most expensive
  if (/\b(cheap|cheapest|least expensive|lowest price|affordable|budget)\b/.test(text) && extractBudget(text) === null) {
    const cheapest = [...products].sort((a, b) => a.price - b.price)[0];
    return `The most budget-friendly is the ${cheapest.name} at ${money(cheapest.price)}. ${cheapest.description}`;
  }
  if (/\b(expensive|premium|top|best|high end|priciest)\b/.test(text) && !/best (for|to)\b/.test(text)) {
    const priciest = [...products].sort((a, b) => b.price - a.price)[0];
    return `Our top pick is the ${priciest.name} at ${money(priciest.price)}. ${priciest.description}`;
  }

  // Budget-constrained recommendation
  const budget = extractBudget(text);
  if (budget !== null) {
    const affordable = products.filter((p) => p.price <= budget).sort((a, b) => b.price - a.price);
    if (affordable.length === 0) {
      const cheapest = [...products].sort((a, b) => a.price - b.price)[0];
      return `Everything's a touch above ${money(budget)} right now — the closest is the ${cheapest.name} at ${money(cheapest.price)}.`;
    }
    // Prefer ones that also match other keywords in the query.
    const ranked = scoreProducts(text, affordable);
    const pick = ranked[0].score > 0 ? ranked[0].product : affordable[0];
    return `Under ${money(budget)} I'd go with the ${pick.name} at ${money(pick.price)}. ${pick.description}`;
  }

  // Price question about a specific/known product
  if (/\b(price|cost|how much)\b/.test(text)) {
    const [top] = retrieveRelevant(text, products, 1);
    if (top) return `The ${top.name} is ${money(top.price)}. ${top.description}`;
  }

  // General recommendation / product search via keyword retrieval
  const scored = scoreProducts(text, products);
  if (scored[0]?.score > 0) {
    const best = scored[0].product;
    const alt = scored[1]?.score > 0 ? scored[1].product : null;
    let reply = `I'd suggest the ${best.name} at ${money(best.price)}. ${best.description}`;
    if (alt) reply += ` If you'd like another option, the ${alt.name} (${money(alt.price)}) is also lovely.`;
    return reply;
  }

  // Fallback — stay helpful and nudge toward the catalog
  const sample = products.slice(0, 3).map((p) => p.name);
  return `I'm not totally sure what you mean, but I can dig in! Your catalog has ${list(sample)} and more. What would you like me to look into?`;
}
