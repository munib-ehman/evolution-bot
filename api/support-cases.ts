import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { runSupportCasesAction, runSupportCasesGet } from "./_supportCases";

export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  const env = recoveryCampaignEnvFromProcess();
  const role = new URL(req.url).searchParams.get("role") === "operations" ? "operations" : "customer-success";
  if (req.method === "GET") return runSupportCasesGet(req.headers.get("authorization"), env, role);
  if (req.method === "POST") return runSupportCasesAction(await req.json().catch(() => ({})) as Record<string, unknown>, req.headers.get("authorization"), env, role);
  return new Response("Method not allowed", { status: 405 });
}
