import { chromium } from "playwright";
import { mkdirSync } from "fs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
const routes=["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
const rep=[];
for(const r of routes){
 await page.goto(BASE+"/"+r,{waitUntil:"load"}).catch(()=>{});
 await page.waitForTimeout(3000);
 const m=await page.evaluate(()=>{
  let maxFont=0,textLen=0;
  document.querySelectorAll("body *").forEach(e=>{
   const cs=getComputedStyle(e);if(cs.display==="none"||cs.visibility==="hidden")return;
   const t=(e.childElementCount===0?e.textContent:"")||"";if(t.trim())textLen+=t.trim().length;
   const f=parseFloat(cs.fontSize);if(f>maxFont&&t.trim())maxFont=f;});
  const interactive=document.querySelectorAll("button,input,a,.chip,canvas,[tabindex]").length;
  return {maxFont:Math.round(maxFont),textLen,interactive};});
 rep.push({r:r||"/",...m});
 await page.screenshot({path:out+"/c-"+(r||"home")+".png"});
}
// interaction proof on /
await page.goto(BASE+"/",{waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(2500);
const before=await page.evaluate(()=>document.getElementById("dname")?document.getElementById("dname").textContent:"");
const chips=await page.evaluate(()=>document.querySelectorAll(".chip").length);
await page.evaluate(()=>{var c=document.querySelectorAll(".chip");if(c[3])c[3].click();});
await page.waitForTimeout(500);
const after=await page.evaluate(()=>document.getElementById("dname")?document.getElementById("dname").textContent:"");
const detail=await page.evaluate(()=>({pos:document.getElementById("dpos").textContent,house:document.getElementById("dhouse").textContent,asp:(document.getElementById("daspects").textContent||"").slice(0,60)}));
console.log("CONTENT "+JSON.stringify({rep,before,after,chips,detail}));
await browser.close();
