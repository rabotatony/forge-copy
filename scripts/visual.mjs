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
const rep={};
// A: fresh full journey
let ctx=await browser.newContext({viewport:{width:1280,height:800}});
let page=await ctx.newPage();
await page.goto(BASE+"/hana",{waitUntil:"load"}).catch(()=>{});
await page.fill("#bd","1990-10-05").catch(()=>{});
await page.dispatchEvent("#bd","change").catch(()=>{});
await page.waitForTimeout(4000);
const routes=["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
rep.A=[];
for(const r of routes){await page.goto(BASE+"/"+r,{waitUntil:"load"}).catch(()=>{});await page.waitForTimeout(3500);
 const f=out+"/A-"+(r||"home")+".png";await page.screenshot({path:f});rep.A.push({r:r||"/",rich:rich(f)});}
// B: partial + refresh persistence
await page.goto(BASE+"/hakara",{waitUntil:"load"}).catch(()=>{});
await page.mouse.move(870,400);await page.mouse.down();await page.waitForTimeout(1200);await page.mouse.up();
await page.reload({waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(3000);
await page.screenshot({path:out+"/B-hakara.png"});rep.B={hakara:rich(out+"/B-hakara.png")};
// C: direct mid with NO state
let ctx2=await browser.newContext({viewport:{width:1280,height:800}});
let p2=await ctx2.newPage();
await p2.goto(BASE+"/tirgum",{waitUntil:"load"}).catch(()=>{});
await p2.waitForTimeout(3500);
await p2.screenshot({path:out+"/C-tirgum.png"});rep.C={tirgum_fresh:rich(out+"/C-tirgum.png")};
// R2: human voice returns at /
await p2.evaluate(()=>{localStorage.setItem("tikun",JSON.stringify([{previousText:"אני מתחיל הרבה",correctedText:"אני בוחר להתחיל",moment:"2026-01-01",version:"0.1"}]));localStorage.setItem("ktiva",JSON.stringify([{userText:"אני מתחיל הרבה",moment:"2026-01-01",version:"0.1"}]));});
await p2.goto(BASE+"/",{waitUntil:"load"}).catch(()=>{});
await p2.waitForTimeout(2500);
rep.R2_idea=await p2.evaluate(()=>document.getElementById("idea")?document.getElementById("idea").textContent:"");
await browser.close();
console.log("TRIP "+JSON.stringify(rep));
