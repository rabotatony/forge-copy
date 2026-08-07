import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";
import png from "pngjs";
const BASE=process.env.BASE||"https://roses-cj2.pages.dev";
const out=process.env.OUT||"visual";
mkdirSync(out,{recursive:true});
const routes=["","hana","hakara","shkila"];
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on("pageerror",e=>errors.push("pageerror:"+String(e).slice(0,80)));
function ascii(path){
 try{
  const p=png.PNG.sync.read(readFileSync(path));
  const W=72,H=34;const sx=Math.floor(p.width/W),sy=Math.floor(p.height/H);
  const chars=" .:-=+*#%@";let rows=[];
  for(let y=0;y<H;y++){let line="";
   for(let x=0;x<W;x++){let sum=0,cnt=0;
    for(let dy=0;dy<sy;dy+=2)for(let dx=0;dx<sx;dx+=2){const i=((y*sy+dy)*p.width+(x*sx+dx))*4;sum+=0.2126*p.data[i]+0.7152*p.data[i+1]+0.0722*p.data[i+2];cnt++;}
    // edge-energy: deviation within cell -> shows structure on dark OR light
    let mn=255,mx=0;for(let dy=0;dy<sy;dy+=2)for(let dx=0;dx<sx;dx+=2){const i=((y*sy+dy)*p.width+(x*sx+dx))*4;const l=0.2126*p.data[i]+0.7152*p.data[i+1]+0.0722*p.data[i+2];if(l<mn)mn=l;if(l>mx)mx=l;}
    const e=(mx-mn)/255;line+=chars[Math.min(chars.length-1,Math.floor(e*chars.length))];}
   rows.push(line);}
  return rows.join("\n");
 }catch(e){return "ascii-err:"+e.message;}
}
let report=[];
for(const r of routes){
 await page.goto(BASE+"/"+r,{waitUntil:"load",timeout:20000}).catch(()=>{});
 await page.waitForTimeout(4200);
 const f=out+"/d-"+(r||"home")+".png";
 await page.screenshot({path:f});
 report.push({route:r||"/",ascii:ascii(f)});
}
await browser.close();
for(const rt of report){console.log("ASCII_"+rt.route+"\n"+rt.ascii+"\nEND_"+rt.route);}
console.log("ERR "+JSON.stringify(errors.slice(0,5)));
