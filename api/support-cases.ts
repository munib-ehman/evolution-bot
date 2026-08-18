import { recoveryCampaignEnvFromProcess } from "./_recoveryCampaigns";
import { runSupportCasesAction, runSupportCasesGet } from "./_supportCases";

export const config = { runtime: "edge" };
export default async function handler(req: Request): Promise<Response> {
  const env = recoveryCampaignEnvFromProcess();
  if (req.method === "GET") return runSupportCasesGet(req.headers.get("authorization"), env);
  if (req.method === "POST") return runSupportCasesAction(await req.json().catch(() => ({})) as Record<string, unknown>, req.headers.get("authorization"), env);
  return new Response("Method not allowed", { status: 405 });
}
