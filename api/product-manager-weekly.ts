import { productManagerCronEnv,runProductManagerWeekly } from "./_productManagerCron";
export const config={runtime:"edge"};
export default async function handler(req:Request){return runProductManagerWeekly(req.headers.get("authorization"),productManagerCronEnv());}
