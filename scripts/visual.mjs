import { chromium } from "playwright";
import { mkdirSync } from "fs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const errors=[];
async function newPage(vp){const p=await browser.newPage({viewport:vp});
 p.on("console",m=>{if(m.type()==="error")errors.push("console:"+m.text().slice(0,120));});
 p.on("pageerror",e=>errors.push("pageerror:"+String(e).slice(0,120)));
 p.on("response",r=>{if(r.status()>=400)errors.push("http"+r.status()+":"+r.url().slice(-40));});
 return p;}
const report={routes:[],errors:[],design:{}};
// desktop full-route pass
let page=await newPage({width:1280,height:800});
for(const r of ["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"]){
 await page.goto(BASE+"/"+r,{waitUntil:"load",timeout:20000}).catch(()=>{});
 await page.waitForTimeout(600);
 const m=await page.evaluate(()=>({
  hscroll:document.documentElement.scrollWidth>document.documentElement.clientWidth,
  ideaFS:getComputedStyle(document.querySelector(".idea,.say,#idea")||document.body).fontSize,
  bg:getComputedStyle(document.body).backgroundColor}));
 report.routes.push({route:r||"/",...m});
 await page.screenshot({path:out+"/d-"+(r||"home")+".png"});
}
// interaction states on / and /hana (desktop)
async function states(route,name,act){
 const p=await newPage({width:1280,height:800});
 await p.goto(BASE+"/"+route,{waitUntil:"load"}).catch(()=>{});
 await p.waitForTimeout(500);
 await p.screenshot({path:out+"/s-"+name+"-1-before.png"});
 await act(p);
 await p.waitForTimeout(500);
 await p.screenshot({path:out+"/s-"+name+"-2-during.png"});
 await p.waitForTimeout(900);
 await p.screenshot({path:out+"/s-"+name+"-3-after.png"});
 await p.close();
}
await states("","home",async p=>{const b=await p.$(".machine,#m");const bb=await b.boundingBox();
 await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();await p.waitForTimeout(700);});
await states("hana","hana",async p=>{await p.fill("#bd","1990-10-05").catch(()=>{});await p.keyboard.press("Enter");});
// mobile pass
let mp=await newPage({width:390,height:844});
for(const r of ["","hana","ktiva"]){
 await mp.goto(BASE+"/"+r,{waitUntil:"load"}).catch(()=>{});
 await mp.waitForTimeout(500);
 const m=await mp.evaluate(()=>({hscroll:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
 report.routes.push({route:"m:"+(r||"/"),...m});
 await mp.screenshot({path:out+"/m-"+(r||"home")+".png"});
}
// design metrics on /
await page.goto(BASE+"/",{waitUntil:"load"});await page.waitForTimeout(400);
report.design=await page.evaluate(()=>{
 const idea=document.querySelector(".idea,#idea");const cs=getComputedStyle(idea||document.body);
 return {ideaFontSize:cs.fontSize,ideaLineHeight:cs.lineHeight,ideaMaxWidth:cs.maxWidth,
  bodyBg:getComputedStyle(document.body).backgroundColor,
  letterSpacing:cs.letterSpacing,family:cs.fontFamily.slice(0,40)};});
report.errors=errors.slice(0,20);
await browser.close();
console.log("DESIGN_REPORT "+JSON.stringify(report));
