import { actionEnvFromProcess } from "./_actions";
import { runAutonomy } from "./_autonomy";
export const config={runtime:"edge"};
export default async function handler(req:Request){return runAutonomy(req,actionEnvFromProcess());}
