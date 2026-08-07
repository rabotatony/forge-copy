import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import png from "pngjs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
function ascii(path){try{const p=png.PNG.sync.read(readFileSync(path));const W=76,H=36;const sx=Math.floor(p.width/W),sy=Math.floor(p.height/H);
 const chars=" .:-=+*#%@";let rows=[];
 for(let y=0;y<H;y++){let line="";for(let x=0;x<W;x++){let mn=255,mx=0;
  for(let dy=0;dy<sy;dy+=2)for(let dx=0;dx<sx;dx+=2){const i=((y*sy+dy)*p.width+(x*sx+dx))*4;const l=0.2126*p.data[i]+0.7152*p.data[i+1]+0.0722*p.data[i+2];if(l<mn)mn=l;if(l>mx)mx=l;}
  const e=(mx-mn)/255;line+=chars[Math.min(9,Math.floor(e*10))];}rows.push(line);}
 return rows.join("\n");}catch(e){return "err";}}
const page=await browser.newPage({viewport:{width:1280,height:800}});
await page.goto(BASE+"/",{waitUntil:"load"}).catch(()=>{});
for(const ms of [500,1000,3000,6000,10000,15000]){
 await page.waitForTimeout(ms===500?500:ms-(ms===1000?500:ms===3000?1000:ms===6000?3000:ms===10000?6000:10000));
 const f=out+"/t"+ms+".png";await page.screenshot({path:f});
 console.log("T_"+ms+"\n"+ascii(f)+"\nENDT");
}
await page.setViewportSize({width:390,height:844});
await page.goto(BASE+"/",{waitUntil:"load"}).catch(()=>{});
await page.waitForTimeout(6000);
await page.screenshot({path:out+"/m-home.png"});
console.log("T_mobile\n"+ascii(out+"/m-home.png")+"\nENDT");
await browser.close();
