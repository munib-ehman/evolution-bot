import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { reviewEligibleFulfillment } = await server.ssrLoadModule("/api/_shopifyData.ts");
  const now = Date.parse("2026-08-14T12:00:00Z");
  const success = [{ status: "SUCCESS", createdAt: "2026-08-04T12:00:00Z" }];

  assert.equal(
    reviewEligibleFulfillment({ fulfillmentStatus: "FULFILLED", fulfillments: success }, 7, 30, now),
    "2026-08-04T12:00:00Z",
    "a successfully fulfilled order inside the window is eligible",
  );
  assert.equal(
    reviewEligibleFulfillment({ fulfillmentStatus: "UNFULFILLED", fulfillments: [] }, 7, 30, now),
    null,
    "an unfulfilled order must never be review eligible",
  );
  assert.equal(
    reviewEligibleFulfillment({ cancelledAt: "2026-08-05T12:00:00Z", fulfillmentStatus: "FULFILLED", fulfillments: success }, 7, 30, now),
    null,
    "a cancelled order must never be review eligible",
  );
  assert.equal(
    reviewEligibleFulfillment({ financialStatus: "REFUNDED", fulfillmentStatus: "FULFILLED", fulfillments: success }, 7, 30, now),
    null,
    "a refunded order must never be review eligible",
  );
  assert.equal(
    reviewEligibleFulfillment({ fulfillmentStatus: "FULFILLED", fulfillments: [{ status: "SUCCESS", createdAt: "2026-08-12T12:00:00Z" }] }, 7, 30, now),
    null,
    "a fulfillment that is too recent must wait",
  );
  assert.equal(
    reviewEligibleFulfillment({ fulfillmentStatus: "FULFILLED", fulfillments: [{ status: "SUCCESS", createdAt: "2026-06-01T12:00:00Z" }] }, 7, 30, now),
    null,
    "an old fulfillment must fall out of the review window",
  );

  const { selectedAgentToolNames } = await server.ssrLoadModule("/api/_agentChat.ts");
  const tools = selectedAgentToolNames([{ role: "user", content: "Who should I ask for a review?" }], "customer-success");
  assert.ok(tools.includes("get_retention_snapshot"));
  assert.ok(tools.includes("get_ship_queue"));
  assert.ok(!tools.includes("create_broadcast_campaign"));

  const { buildSupportDraft } = await server.ssrLoadModule("/api/_supportCases.ts");
  const order = { name: "#1001", items: [{ title: "Hydrogen Snowboard", qty: 1 }] };
  const investigating = buildSupportDraft(order, "investigating", "");
  assert.match(investigating.body, /only provide a shipping estimate once it has been confirmed/i);
  assert.match(investigating.body, /cancellation or a refund/i);
  assert.doesNotMatch(investigating.body, /shipped ASAP|update soon/i);
  const confirmed = buildSupportDraft(order, "ship_date", "by Friday, August 21");
  assert.match(confirmed.body, /by Friday, August 21/);
  assert.match(confirmed.body, /Hydrogen Snowboard/);

  console.log("Customer Success safety tests passed");
} finally {
  await server.close();
}
