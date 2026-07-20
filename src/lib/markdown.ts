/**
 * Markdown rendering for skill-report bubbles.
 *
 * Security model: the LLM's output can echo strings derived from store data,
 * so raw HTML must never pass through. We escape `&` and `<` BEFORE parsing —
 * marked then only ever emits its own generated tags.
 */
import { marked } from "marked";

export function renderMarkdown(src: string): string {
  const escaped = src.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return marked.parse(escaped, { gfm: true, breaks: true, async: false });
}
