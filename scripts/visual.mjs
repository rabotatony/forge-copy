import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import png from "pngjs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
function rich(path){try{const p=png.PNG.sync.read(readFileSync(path));const W=64,H=32;const sx=Math.floor(p.width/W),sy=Math.floor(p.height/H);
 let hit=0,tot=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){let mn=255,mx=0;
  for(let dy=0;dy<sy;dy+=2)for(let dx=0;dx<sx;dx+=2){const i=((y*sy+dy)*p.width+(x*sx+dx))*4;const l=0.2126*p.data[i]+0.7152*p.data[i+1]+0.0722*p.data[i+2];if(l<mn)mn=l;if(l>mx)mx=l;}
  tot++;if((mx-mn)/255>0.12)hit++;}
 return +(hit/tot).toFixed(3);}catch(e){return -1;}}
const browser=await chromium.launch();
const routes=["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
const ctx=await browser.newContext({viewport:{width:1280,height:800}});
const page=await ctx.newPage();
// stateful journey: set the moment first so machines have real material
await page.goto(BASE+"/hana",{waitUntil:"load"}).catch(()=>{});
await page.fill("#bd","1990-10-05").catch(()=>{});
await page.dispatchEvent("#bd","change").catch(()=>{});
await page.waitForTimeout(5000);
const rep=[];
for(const r of routes){
 await page.goto(BASE+"/"+r,{waitUntil:"load"}).catch(()=>{});
 await page.waitForTimeout(4000);
 const f=out+"/j-"+(r||"home")+".png";await page.screenshot({path:f});
 rep.push({route:r||"/",rich:rich(f)});
}
await page.setViewportSize({width:390,height:844});
await page.goto(BASE+"/",{waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(4000);
await page.screenshot({path:out+"/j-mobile.png"});
rep.push({route:"mobile",rich:rich(out+"/j-mobile.png")});
await browser.close();
console.log("JOURNEY "+JSON.stringify(rep));
