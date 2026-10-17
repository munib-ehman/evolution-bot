import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {siteVersion} from './site-version.mjs';
assert.equal(siteVersion({EVOLUTION_SITE_VERSION:'ecommerce'}),'ecommerce');
assert.equal(siteVersion({EVOLUTION_SITE_VERSION:'cofounder'}),'cofounder');
assert.throws(()=>siteVersion({EVOLUTION_SITE_VERSION:'typo'}));
for(const name of ['index.html','app.html','src/App.tsx','src/main.tsx','public/pages.css','public/favicon.svg','public/robots.txt','public/sitemap.xml','public/llms.txt','public/privacy.html','public/terms.html']){
 assert.deepEqual(fs.readFileSync(name),execFileSync('git',['show','evolution-v1-ecommerce-2026-10-17:'+name]),'v1 preserved: '+name);
}
const sitemap=fs.readFileSync('versions/cofounder/public/sitemap.xml','utf8');
assert(!sitemap.includes('/audit'));assert(!sitemap.includes('/blog/'));assert(sitemap.includes('/faq'));
const v2=fs.readFileSync('versions/cofounder/index.html','utf8');assert(v2.includes('/src/cofounder/preview.tsx'));assert(v2.includes('Your AI co-founder'));assert(!v2.includes('Cart recovery'));
for(const page of ['pricing','faq','privacy','terms','contact','refund'])assert(fs.existsSync('versions/cofounder/public/'+page+'.html'));
if(fs.existsSync('dist/index.html')){
 const built=fs.readFileSync('dist/index.html','utf8');
 if(process.env.EVOLUTION_SITE_VERSION==='ecommerce'){assert(built.includes('AI operator for Shopify'));assert(!fs.existsSync('dist/site-version.json'));}
 else{assert(built.includes('Your AI co-founder'));assert(!built.includes('/src/cofounder/'));assert.equal(JSON.parse(fs.readFileSync('dist/site-version.json','utf8')).version,'cofounder');assert(!fs.existsSync('dist/blog'));assert.equal(fs.readFileSync('dist/sitemap.xml','utf8'),sitemap);assert(!fs.readFileSync('dist/app.html','utf8').includes('shopify-api-key'));}
}
console.log('PASS: exact v1 sources preserved; explicit version selection; v2 content, metadata, routes and build isolation.');
