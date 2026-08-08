import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import png from "pngjs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
function rich(path){try{const p=png.PNG.sync.read(readFileSync(path));const W=64,H=32;const sx=Math.floor(p.width/W),sy=Math.floor(p.height/H);
 let hit=0,tot=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){let mn=255,mx=0;
  for(let dy=0;dy<sy;dy+=2)for(let dx=0;dx<sx;dx+=2){const i=((y*sy+dy)*p.width+(x*sx+dx))*4;const l=0.2126*p.data[i]+0.7152*p.data[i+1]+0.0722*p.data[i+2];if(l<mn)mn=l;if(l>mx)mx=l;}tot++;if((mx-mn)/255>0.12)hit++;}
 return +(hit/tot).toFixed(3);}catch(e){return -1;}}
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:"reduce"});
const page=await ctx.newPage();
await page.goto(BASE+"/",{waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(2500);
const stat=await page.evaluate(()=>{
 let maxFont=0,textLen=0;
 document.querySelectorAll("#panel *").forEach(e=>{const cs=getComputedStyle(e);const t=(e.childElementCount===0?e.textContent:"")||"";if(t.trim()){textLen+=t.trim().length;const f=parseFloat(cs.fontSize);if(f>maxFont)maxFont=f;}});
 return {maxFont:Math.round(maxFont),textLen,rows:document.querySelectorAll("#allbodies .row").length,aspects:document.querySelectorAll("#asplist div").length,
  dname:document.getElementById("dname").textContent,dpos:document.getElementById("dpos").textContent};});
await page.screenshot({path:out+"/inst-static.png"});
const before=stat.dname;
await page.evaluate(()=>{var r=document.querySelectorAll("#allbodies .row");if(r[3])r[3].click();});
await page.waitForTimeout(300);
const after=await page.evaluate(()=>document.getElementById("dname").textContent);
console.log("INSTRUMENT "+JSON.stringify({stat,rich:rich(out+"/inst-static.png"),before,after,interactionChanged:before!==after}));
await browser.close();
