import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import png from "pngjs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
function ascii(path){try{const p=png.PNG.sync.read(readFileSync(path));const W=76,H=36;const sx=Math.floor(p.width/W),sy=Math.floor(p.height/H);
 const chars=" .:-=+*#%@";let rows=[];
 for(let y=0;y<H;y++){let line="";for(let x=0;x<W;x++){let mn=255,mx=0;
  for(let dy=0;dy<sy;dy+=2)for(let dx=0;dx<sx;dx+=2){const i=((y*sy+dy)*p.width+(x*sx+dx))*4;const l=0.2126*p.data[i]+0.7152*p.data[i+1]+0.0722*p.data[i+2];if(l<mn)mn=l;if(l>mx)mx=l;}
  const e=(mx-mn)/255;line+=chars[Math.min(9,Math.floor(e*10))];}rows.push(line);}
 return rows.join("\n");}catch(e){return "err";}}
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
async function shot(route,ms,fillDate){
 await page.goto(BASE+"/"+route,{waitUntil:"load"}).catch(()=>{});
 if(fillDate){await page.fill("#bd","1990-10-05").catch(()=>{});await page.dispatchEvent("#bd","change").catch(()=>{});}
 await page.waitForTimeout(ms);
 const f=out+"/r-"+(route||"home")+".png";await page.screenshot({path:f});
 console.log("R_"+(route||"home")+"\n"+ascii(f)+"\nENDR");
}
await shot("",6000,false);
await shot("hana",6000,true);
await shot("hakara",3000,false);
await shot("shkila",3000,false);
await page.setViewportSize({width:390,height:844});
await shot("",6000,false);
await browser.close();
