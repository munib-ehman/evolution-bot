import { bearer } from "./recovery";

export type DailyPace="light"|"balanced"|"active";
export interface AutonomyContract{user_id:string;daily_pace:DailyPace;max_actions_per_day:number;prepared_today:number;daily_digest:boolean;setup_complete:boolean}
export interface AutonomyState{contract:AutonomyContract;watching:string[]}
async function request(method:"GET"|"POST",body?:unknown){
  const token=await bearer(),response=await fetch("/api/autonomy",{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}),data=await response.json().catch(()=>({})) as Partial<AutonomyState>&{error?:string};
  if(!response.ok)throw new Error(data.error??"Autopilot request failed.");
  return data;
}
export const getAutonomy=()=>request("GET") as Promise<AutonomyState>;
export const saveAutonomy=(settings:{daily_pace:DailyPace;daily_digest:boolean})=>request("POST",settings) as Promise<{contract:AutonomyContract}>;
