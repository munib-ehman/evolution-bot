import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [recovery,winback,broadcast,review,safety,intelligence,attribution,migration,status]=await Promise.all([
  read("api/_recoveryCampaigns.ts"),read("api/_winbackCampaigns.ts"),read("api/_broadcastCampaigns.ts"),read("api/_reviewCampaigns.ts"),read("api/_marketingSafety.ts"),read("api/_marketingIntelligence.ts"),read("api/_marketingAttribution.ts"),read("supabase/2026-08-22_intelligent_marketing_agent.sql"),read("api/_marketingStatus.ts"),
]);
for(const [name,source,table] of [["recovery",recovery,"recovery_campaigns"],["winback",winback,"winback_campaigns"],["broadcast",broadcast,"broadcast_campaigns"],["review",review,"review_campaigns"]]){
  assert.match(source,new RegExp(`canonicalActivityId\\(env,["']${table}["']`),`${name} must resolve a canonical activity before delivery`);
  assert.match(source,/reserveContact\(env,\s*\{[^}]*activityId/s,`${name} must attach the canonical activity to the contact ledger`);
}
assert.match(safety,/marketing_global_suppressions/,"global suppression must be enforced");
assert.match(migration,/p\.quiet_start>p\.quiet_end/,"quiet hours must support overnight ranges");
assert.match(migration,/p\.quiet_start<p\.quiet_end/,"quiet hours must support same-day ranges");
assert.match(intelligence,/validateCanonicalApproval/,"approval must be revalidated");
assert.match(intelligence,/marketing_decision_runs/,"automatic decisions must be auditable");
assert.match(intelligence,/Holdout/,"V1 experiments must include a holdout");
assert.match(attribution,/variant_id:variantId/,"orders must retain variant attribution");
assert.match(status,/afterApproval/,"the decision UI must explain post-approval execution");
console.log("marketing-agent: identity, safety, approval, explanation, experimentation, and attribution invariants passed");
