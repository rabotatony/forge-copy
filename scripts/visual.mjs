import { chromium } from "playwright";
import { mkdirSync } from "fs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:"reduce"});
const page=await ctx.newPage();
// seed a real moment so machines have real data
await page.goto(BASE+"/hana",{waitUntil:"load"}).catch(()=>{});
await page.fill("#bd","1990-10-05").catch(()=>{});
await page.dispatchEvent("#bd","change").catch(()=>{});
await page.waitForTimeout(1500);
const routes=["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
const rep=[];
for(const r of routes){
 await page.goto(BASE+"/"+r,{waitUntil:"load"}).catch(()=>{});
 await page.waitForTimeout(2000);
 const m=await page.evaluate(()=>{let maxFont=0,textLen=0;
  document.querySelectorAll("body *").forEach(e=>{const cs=getComputedStyle(e);if(cs.display==="none")return;const t=(e.childElementCount===0?e.textContent:"")||"";if(t.trim()){textLen+=t.trim().length;const f=parseFloat(cs.fontSize);if(f>maxFont)maxFont=f;}});
  return {maxFont:Math.round(maxFont),textLen,interactive:document.querySelectorAll("button,input,select,textarea,.row,.p,.f,.i,[tabindex],canvas").length};});
 rep.push({r:r||"/",...m});
 await page.screenshot({path:out+"/f-"+(r||"home")+".png"});
}
// refresh persistence on /tikun
await page.goto(BASE+"/ktiva",{waitUntil:"load"}).catch(()=>{});
await page.fill("#surf","אני מתחיל הרבה דברים").catch(()=>{});
await page.keyboard.press("Enter").catch(()=>{});
await page.goto(BASE+"/tikun",{waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(1000);
const v1=await page.evaluate(()=>{var e=document.getElementById("v1t");return e?e.textContent:"";});
await page.reload({waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(1000);
const v1b=await page.evaluate(()=>{var e=document.getElementById("v1t");return e?e.textContent:"";});
console.log("FINAL "+JSON.stringify({rep,v1,v1b,persist:v1===v1b&&v1.length>0}));
await browser.close();
