/**
 * Ultra-light keyword "retrieval" over the product list — no vector DB, no API,
 * no cost. It scores each product against the shopper's words (name, tags,
 * description) and returns the best few to stuff into the LLM context (or to use
 * directly in mock mode). Good enough for a small catalog.
 */
import type { Product } from "../types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "is", "are", "do", "you",
  "have", "any", "with", "my", "me", "i", "want", "need", "looking", "some", "what", "whats",
  "can", "could", "would", "please", "show", "tell", "about", "good", "best", "recommend",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Naive singular/plural folding so "headphones" matches the tag "headphone". */
function stem(word: string): string {
  return word.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
}

export interface ScoredProduct {
  product: Product;
  score: number;
}

export function scoreProducts(query: string, products: Product[]): ScoredProduct[] {
  const words = tokenize(query).map(stem);
  const scored = products.map((product) => {
    const haystackName = product.name.toLowerCase();
    const haystackTags = product.tags.map((t) => t.toLowerCase());
    const haystackDesc = product.description.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (haystackTags.some((t) => stem(t) === w || t.includes(w))) score += 3;
      if (haystackName.includes(w)) score += 2;
      if (haystackDesc.includes(w)) score += 1;
    }
    return { product, score };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** Top-N products for the query. Falls back to a spread of the catalog if nothing matches. */
export function retrieveRelevant(query: string, products: Product[], n = 4): Product[] {
  const scored = scoreProducts(query, products);
  const matched = scored.filter((s) => s.score > 0).slice(0, n).map((s) => s.product);
  if (matched.length > 0) return matched;
  // No keyword hits — hand the model a small representative sample instead.
  return products.slice(0, n);
}

/** Compact one-line-per-product formatting for the LLM context window. */
export function formatProducts(products: Product[]): string {
  return products
    .map(
      (p) =>
        `- ${p.name} — $${p.price.toFixed(2)} — ${p.description} (tags: ${p.tags.join(", ")})`,
    )
    .join("\n");
}
