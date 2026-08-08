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
let before="",after="",chips=0,detail={};
try{
 before=await page.evaluate(()=>{var e=document.getElementById("dname");return e?e.textContent:"";});
 chips=await page.evaluate(()=>document.querySelectorAll(".chip").length);
 await page.evaluate(()=>{var c=document.querySelectorAll(".chip");if(c[3])c[3].click();});
 await page.waitForTimeout(500);
 after=await page.evaluate(()=>{var e=document.getElementById("dname");return e?e.textContent:"";});
 detail=await page.evaluate(()=>{var g=function(id){var e=document.getElementById(id);return e?e.textContent:"";};return {pos:g("dpos"),house:g("dhouse"),asp:g("daspects").slice(0,60)};});
}catch(e){detail={err:String(e).slice(0,80)};}
console.log("CONTENT "+JSON.stringify({rep,before,after,chips,detail}));
await browser.close();
