import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function siteVersion(env=process.env){
 const version=env.EVOLUTION_SITE_VERSION||JSON.parse(fs.readFileSync(path.join(root,'site-version.json'),'utf8')).version;
 if(!['ecommerce','cofounder'].includes(version))throw Error('Version must be ecommerce (v1) or cofounder (v2).');
 return version;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const v=process.argv[2];if(!['ecommerce','cofounder'].includes(v))throw Error('Use npm run version:v1 or npm run version:v2');
 fs.writeFileSync(path.join(root,'site-version.json'),JSON.stringify({version:v},null,2)+'\n');console.log(`Selected ${v}. Rebuild and deploy to publish it.`);
}
