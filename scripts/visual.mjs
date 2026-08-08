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

// ---- READING TEST (professional) ----
const rp=await browser.newPage({viewport:{width:1280,height:900}});
const errs=[];rp.on("pageerror",e=>errs.push(String(e).slice(0,80)));rp.on("console",c=>{if(c.type()==="error")errs.push("c:"+c.text().slice(0,60));});
await rp.goto(BASE+"/reading",{waitUntil:"load"}).catch(()=>{});
await rp.fill("#bd","1990-10-05").catch(()=>{});
await rp.fill("#nm","David Cohen").catch(()=>{});
await rp.click("#go").catch(()=>{});
await rp.waitForTimeout(800);
const ov=await rp.evaluate(()=>{const v=[...document.querySelectorAll("#out .ov .v")].map(e=>e.textContent);return v;});
const sunOk=ov.some(t=>t.includes("מאזניים"));
const lifeOk=ov.some(t=>t.trim()==="7");
// expand first body item
await rp.evaluate(()=>{const hd=document.querySelector("#out .item .hd");if(hd)hd.click();});
await rp.waitForTimeout(600);
const expanded=await rp.evaluate(()=>{const it=document.querySelector("#out .item");return it?it.classList.contains("open")&&it.querySelector(".bd").textContent.includes("בית"):false;});
const items=await rp.evaluate(()=>document.querySelectorAll("#out .item").length);
await rp.screenshot({path:out+"/reading-desktop.png"});
await rp.setViewportSize({width:390,height:844});
await rp.waitForTimeout(400);
await rp.screenshot({path:out+"/reading-mobile.png"});
console.log("TEST "+JSON.stringify({sunOk,lifeOk,expanded,items,errors:errs.slice(0,5)}));

await browser.close();
