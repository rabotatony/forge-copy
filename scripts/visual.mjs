import { chromium } from "playwright";
import { mkdirSync } from "fs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
const routes=["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
const report=[];const errors=[];
page.on("console",m=>{if(m.type()==="error")errors.push("console:"+m.text().slice(0,100));});
page.on("pageerror",e=>errors.push("pageerror:"+String(e).slice(0,100)));
function vis(sel){return page.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;
 const cs=getComputedStyle(e);const r=e.getBoundingClientRect();
 return {op:parseFloat(cs.opacity),w:Math.round(r.width),h:Math.round(r.height)};},sel);}
for(const r of routes){
 const url=BASE+"/"+r;
 await page.goto(url,{waitUntil:"load",timeout:20000}).catch(()=>{});
 await page.waitForTimeout(4200); // let auto-sequence finish
 const primary=await vis(".idea,.piece,.claim,.say,#idea,.line");
 const secondary=await vis(".chart,.secondary,.piles,.tension,.strata");
 const data=await vis(".data,.tertiary");
 const next=await vis(".next,.nxt,#hemshech");
 const hscroll=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
 report.push({route:r||"/",primary,secondary,data,next,hscroll});
 await page.screenshot({path:out+"/d-"+(r||"home")+".png"});
}
// mobile spot check
await page.setViewportSize({width:390,height:844});
for(const r of ["","hana"]){
 await page.goto(BASE+"/"+r,{waitUntil:"load"}).catch(()=>{});
 await page.waitForTimeout(3500);
 const primary=await vis(".idea,.piece,#idea");
 const hscroll=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
 report.push({route:"m:"+(r||"/"),primary,hscroll});
 await page.screenshot({path:out+"/m-"+(r||"home")+".png"});
}
await browser.close();
console.log("VISUAL_REPORT "+JSON.stringify({errors:errors.slice(0,10),report}));
