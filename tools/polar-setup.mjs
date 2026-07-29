#!/usr/bin/env node
/**
 * One-shot Polar setup — replaces the click-through steps in .env.example:
 * creates the $100/mo Operator product and the /api/polar-webhook endpoint,
 * then prints the three env vars to paste into Vercel.
 *
 * Usage:
 *   POLAR_ACCESS_TOKEN=polar_oat_... node tools/polar-setup.mjs
 *   POLAR_API_BASE=https://sandbox-api.polar.sh POLAR_ACCESS_TOKEN=... node tools/polar-setup.mjs
 *
 * The token must be an ORGANIZATION access token (Settings → Developers) with
 * scopes: products:read, products:write, webhooks:read, webhooks:write
 * (plus checkouts:write, customer_sessions:write, subscriptions:read and
 * subscriptions:write — the runtime needs those anyway, so one token serves
 * both this script and Vercel).
 *
 * Idempotent: re-running finds the existing product/endpoint by name/URL
 * instead of duplicating them. Creating the org itself (and MoR review) is
 * the one step that stays manual at polar.sh.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Node doesn't auto-load .env — read the repo-root one for the POLAR_* vars
// (shell env still wins, so `POLAR_ACCESS_TOKEN=... node ...` overrides).
const dotenv = {};
try {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*(POLAR_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) dotenv[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env — fine, shell env only
}
const envVar = (name) => (process.env[name] ?? dotenv[name] ?? "").trim();

const API_BASE = envVar("POLAR_API_BASE") || "https://api.polar.sh";
const TOKEN = envVar("POLAR_ACCESS_TOKEN");

const PRODUCT_NAME = "Evolution Operator";
const PRICE_CENTS = 10_000; // $100/mo
const WEBHOOK_URL =
  process.argv[2] ?? "https://www.runevolution.io/api/polar-webhook";
const WEBHOOK_EVENTS = ["subscription.active", "subscription.revoked"];

if (!TOKEN) {
  console.error("Set POLAR_ACCESS_TOKEN (organization access token) first.");
  process.exit(1);
}

async function polar(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

// ── Product ──────────────────────────────────────────────────────────────────
async function ensureProduct() {
  const listed = await polar("GET", "/v1/products/?is_archived=false&limit=100");
  const existing = (listed.items ?? []).find((p) => p.name === PRODUCT_NAME);
  if (existing) {
    console.log(`✓ Product already exists: "${PRODUCT_NAME}" (${existing.id})`);
    return existing.id;
  }
  const created = await polar("POST", "/v1/products/", {
    name: PRODUCT_NAME,
    description:
      "Evolution — the AI COO for your ecommerce store. Full app access: recovery, retention, ops center, agent chat and skills.",
    recurring_interval: "month",
    prices: [
      { amount_type: "fixed", price_currency: "usd", price_amount: PRICE_CENTS },
    ],
  });
  console.log(`✓ Created product "${PRODUCT_NAME}" at $${PRICE_CENTS / 100}/mo (${created.id})`);
  return created.id;
}

// ── Webhook endpoint ─────────────────────────────────────────────────────────
async function ensureWebhook() {
  const listed = await polar("GET", "/v1/webhooks/endpoints/?limit=100");
  const existing = (listed.items ?? []).find((e) => e.url === WEBHOOK_URL);
  if (existing) {
    console.log(`✓ Webhook endpoint already exists: ${WEBHOOK_URL} (${existing.id})`);
    const missing = WEBHOOK_EVENTS.filter((ev) => !(existing.events ?? []).includes(ev));
    if (missing.length) {
      await polar("PATCH", `/v1/webhooks/endpoints/${existing.id}`, {
        events: [...new Set([...(existing.events ?? []), ...WEBHOOK_EVENTS])],
      });
      console.log(`  ↳ added missing events: ${missing.join(", ")}`);
    }
    // Polar only reveals the secret at creation time; on reuse, rotate it in
    // the dashboard if you no longer have it.
    return existing.secret ?? null;
  }
  const created = await polar("POST", "/v1/webhooks/endpoints/", {
    url: WEBHOOK_URL,
    format: "raw",
    events: WEBHOOK_EVENTS,
  });
  console.log(`✓ Created webhook endpoint ${WEBHOOK_URL} (events: ${WEBHOOK_EVENTS.join(", ")})`);
  return created.secret ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
const productId = await ensureProduct();
const webhookSecret = await ensureWebhook();

const sandbox = API_BASE.includes("sandbox");
console.log(`
Done against ${API_BASE}. Set these in Vercel (Production${sandbox ? " — SANDBOX values, swap before launch" : ""}):

  POLAR_ACCESS_TOKEN=${TOKEN.slice(0, 14)}… (this token)
  POLAR_PRODUCT_ID=${productId}
  POLAR_WEBHOOK_SECRET=${webhookSecret ?? "<existing endpoint — copy or rotate the secret in Polar → Settings → Webhooks>"}${sandbox ? "\n  POLAR_API_BASE=https://sandbox-api.polar.sh" : ""}

Then: run supabase/2026-07-27_polar.sql (if not yet) and redeploy.`);
