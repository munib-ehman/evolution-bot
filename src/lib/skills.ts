/**
 * Client mirror of the skill registry — ids MUST stay in lockstep with
 * SKILLS in api/_skills.ts (the server 400s unknown ids loudly).
 *
 * Skills are the agentic path: with a Shopify store connected, each chip
 * runs a real data pull + analysis server-side and streams a markdown
 * report into the chat. Escalation ("Ask the team to fix this") posts the
 * `file_fixes` concierge skill, which files an ops-queue task and emails
 * the team.
 */

export interface SkillChip {
  /** Server skill id (api/_skills.ts). */
  id: string;
  label: string;
  blurb: string;
  kind: "agentic" | "concierge";
  /** The tasks-table vertical used when this skill's findings get escalated. */
  taskTool: "product" | "marketing" | "support" | "retention" | "operations" | "analytics" | "custom";
}

export const SKILL_CHIPS: SkillChip[] = [
  {
    id: "product_audit",
    label: "Audit my product listings",
    blurb: "Descriptions, images, SEO and stock — checked against your real catalog.",
    kind: "agentic",
    taskTool: "product",
  },
  {
    id: "cart_recovery",
    label: "Cart recovery report",
    blurb: "What abandoned checkouts cost you last month, and what a flow would win back.",
    kind: "agentic",
    taskTool: "marketing",
  },
  {
    id: "retention",
    label: "Retention & reviews snapshot",
    blurb: "Your real repeat-purchase rate and the cheapest revenue you're not collecting.",
    kind: "agentic",
    taskTool: "retention",
  },
  {
    id: "back_in_stock",
    label: "Back-in-stock check",
    blurb: "Sold-out products that are dead ends today, and what they're costing you.",
    kind: "agentic",
    taskTool: "operations",
  },
];

/** The concierge escalation skill (not shown as a primary chip). */
export const FILE_FIXES_SKILL_ID = "file_fixes";
