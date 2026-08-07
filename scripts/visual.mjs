import { chromium } from "playwright";
import { mkdirSync } from "fs";
const BASE = process.env.BASE || "https://roses-cj2.pages.dev";
const out = process.env.OUT || "visual";
mkdirSync(out,{recursive:true});
const routes = ["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:800} });
const report=[];
for(const r of routes){
  const url = BASE + "/" + r;
  await page.goto(url,{waitUntil:"load",timeout:20000}).catch(()=>{});
  await page.waitForTimeout(700);
  const name=(r||"home");
  await page.screenshot({ path: out+"/"+name+".png" });
  const m = await page.evaluate(()=>({
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hasIdea: !!document.querySelector(".idea,#idea,.claim,.forms"),
    trace: (document.getElementById("trace")||{style:{}}).style.opacity
  }));
  report.push({route:r||"/",...m});
}
await browser.close();
console.log("VISUAL_REPORT "+JSON.stringify(report));
