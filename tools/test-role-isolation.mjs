import fs from "node:fs";
import assert from "node:assert/strict";

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const checks={
  marketing:["api/_recovery.ts","api/_recoveryCampaigns.ts","api/_broadcastCampaigns.ts","api/_winbackCampaigns.ts"],
  "customer-success":["api/_retention.ts"],
  seo:["api/_seoManager.ts","api/_seoOptimizer.ts"],
  product:["api/_productManager.ts","api/_catalog.ts"],
  operations:["api/_ops.ts","api/_fulfillment.ts"],
};
for(const [role,files] of Object.entries(checks))for(const file of files){
  const source=read(file);
  assert.match(source,new RegExp(`hasRole\\([^)]*\\"${role.replace("-","\\-")}\\"`),`${file} must enforce ${role}`);
}
const chat=read("api/_agentChat.ts");
assert.match(chat,/hasRole\(env, user\.id, manager/,"chat must authorize its selected manager");
const app=read("src/App.tsx");
const managerSwitcher=read("src/components/ManagerRoleSwitcher.tsx");
const styles=read("src/index.css");
assert.match(app,/managerView&&entitlements&&<ManagerRoleSwitcher/,"the role selector must live inside the active manager workspace");
assert.match(managerSwitcher,/available\.map/,"the switcher must list only purchased manager roles");
assert.doesNotMatch(styles,/\.live-head\s*>\s*div:last-child/,"single-column manager headers must not collapse the role selector beside the title");
assert.doesNotMatch(app,/tasks-btn \$\{marketingView|tasks-btn \$\{productView/,"manager roles must not return as separate header pills");
const actions=read("api/_actions.ts");
assert.match(actions,/actionRoleError/,"stored actions must re-check their owning role");
assert.match(actions,/role=in\.\(/,"action history must filter inaccessible roles");
const support=read("api/_supportCases.ts");
assert.match(support,/role=eq\.\$\{role\}/,"support notifications must be role scoped");
assert.match(support,/loadEmailDeliveryRow\(env, checked\.user\.id, role\)/,"support email identity must be role scoped");
const polar=read("api/_polar.ts");
assert.match(polar,/manager_checkout_intents/,"Polar checkout must persist the selected manager roles");
assert.match(polar,/seats: targetRoles\.length/,"Polar checkout must bill one seat per selected manager");
assert.match(polar,/min_seats: targetRoles\.length/,"Polar checkout must lock the minimum seat count to selected roles");
assert.match(polar,/max_seats: targetRoles\.length/,"Polar checkout must lock the maximum seat count to selected roles");
assert.match(polar,/subscriptions\/\$\{billing\.subscriptionId\}/,"adding managers must update the existing subscription");
console.log("role isolation: verified");
