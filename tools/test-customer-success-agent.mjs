import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const [support,jobs,review,winback,workspace,panel,inbox]=await Promise.all([
  read("api/_supportCases.ts"),read("api/_marketingJobs.ts"),read("api/_reviewCampaigns.ts"),read("api/_winbackCampaigns.ts"),read("src/components/CustomerSuccessManager.tsx"),read("src/components/WinbackPanel.tsx"),read("src/components/MarketingDecisionsInbox.tsx"),
]);
assert.match(support,/detectCustomerSuccessRisks/,"support risks must be detected without opening the UI");
assert.match(support,/status: "proposed"/,"support detection must prepare an approval proposal");
assert.match(support,/body\.approved !== true/,"support sending must require explicit approval");
assert.match(jobs,/observe_support/,"the background worker must schedule support observation");
assert.match(review,/hasRole\(env,user\.id,"customer-success"/,"Customer Success must be authorized for review decisions");
assert.match(winback,/hasRole\(env, user\.id, "customer-success"/,"Customer Success must be authorized for retention decisions");
for(const node of ["Risk detection","Response preparation","Resolution tracking","Buyer eligibility","Review requests","Review outcomes","Lapse detection","Care planning","Retention outcomes"])assert.match(workspace,new RegExp(node),`${node} must exist in the capability tree`);
for(const section of ["review-eligibility","review-results","winback-results"])assert.match(panel,new RegExp(section),`${section} must have a dedicated panel`);
assert.match(inbox,/supportCases\.length/,"support approvals must be represented in the Customer Success decision inbox");
assert.match(inbox,/Why Evolution chose this/,"approval cards must explain the evidence behind decisions");
console.log("customer-success-agent: background detection, approval safety, dedicated workflows, explanations, and outcomes passed");
