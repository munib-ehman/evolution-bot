import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function siteVersion(env=process.env){
 const version=env.EVOLUTION_SITE_VERSION||JSON.parse(fs.readFileSync(path.join(root,'site-version.json'),'utf8')).version;
 if(!['ecommerce','cofounder','network'].includes(version))throw Error('Version must be ecommerce (v1), cofounder (v2) or network (v3).');
 return version;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const v=process.argv[2];if(!['ecommerce','cofounder','network'].includes(v))throw Error('Use npm run version:v1, npm run version:v2 or npm run version:v3');
 fs.writeFileSync(path.join(root,'site-version.json'),JSON.stringify({version:v},null,2)+'\n');console.log(`Selected ${v}. Rebuild and deploy to publish it.`);
}
