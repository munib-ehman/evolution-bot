import fs from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';
import {siteVersion,root} from './site-version.mjs';
// Overlay v2 without editing any v1 HTML, legal pages, assets or application.
export function versionPlugin():Plugin{
 const v=siteVersion(),folder=path.join(root,'versions',v);let outDir='';
 return {
  name:'evolution-site-version',
  configResolved(config){outDir=config.build.outDir;},
  transformIndexHtml:{order:'pre',handler(html,ctx){
   if(v==='ecommerce')return html;
   const name=ctx.path==='/app.html'?'app.html':ctx.path==='/index.html'||ctx.path==='/'?'index.html':null;
   return name?fs.readFileSync(path.join(folder,name),'utf8'):html;
  }},
  configureServer(server){if(v==='ecommerce')return;server.middlewares.use((req,res,next)=>{
   const name=(req.url||'').split('?')[0].replace(/^\//,'').replace(/\.html$/,'');
   const safe=/^[a-z-]+$/.test(name)?name+'.html':name==='sitemap.xml'||name==='llms.txt'||name==='og.svg'||name==='cofounder.css'?name:null;
   if(!safe)return next();const file=path.join(folder,'public',safe);if(!fs.existsSync(file))return next();
   res.setHeader('Content-Type',safe.endsWith('.html')?'text/html; charset=utf-8':safe.endsWith('.xml')?'application/xml':safe.endsWith('.svg')?'image/svg+xml':safe.endsWith('.css')?'text/css':'text/plain; charset=utf-8');res.end(fs.readFileSync(file));
  });},
  closeBundle(){if(v==='ecommerce')return;const out=path.resolve(root,outDir);if(v!=='network')fs.rmSync(path.join(out,'blog'),{force:true,recursive:true});if(v==='network'){for(const name of ['audit.html','contact.html','faq.html','pricing.html','privacy.html','refund.html','terms.html','products.json','pages.css','models','og.png'])fs.rmSync(path.join(out,name),{force:true,recursive:true});}fs.cpSync(path.join(folder,'public'),out,{recursive:true});fs.writeFileSync(path.join(out,'site-version.json'),JSON.stringify({version:v}));}
 };
}
