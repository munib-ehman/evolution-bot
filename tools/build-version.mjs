import {spawnSync} from 'node:child_process';
import {siteVersion,root} from './site-version.mjs';
const version=siteVersion(process.argv.includes('--committed')?{}:process.env);
const contentCommands=version==='ecommerce'?[['node','tools/build-blog.mjs']]:version==='network'?[['node','tools/build-network-guides.mjs']]:[];
const commands=process.argv.includes('--dev')?contentCommands:[...contentCommands,['node','node_modules/typescript/bin/tsc','-b'],['node','node_modules/vite/bin/vite.js','build']];
for(const [cmd,...args] of commands){const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit',env:{...process.env,EVOLUTION_SITE_VERSION:version}});if(r.status!==0)process.exit(r.status||1);}
