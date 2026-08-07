import { chromium } from "playwright";
const BASE = process.env.BASE || "https://roses-cj2.pages.dev";
const routes = ["","hana","hakara","shkila","haamaka","edut","kria","hachlafa","tirgum","ktiva","tikun","hatima","zekher"];
const out = "visual";
import { mkdirSync } from "fs";
mkdirSync(out,{recursive:true});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:800} });
const report=[];
for(const r of routes){
  const url = BASE + "/" + r;
  await page.goto(url,{waitUntil:"networkidle"}).catch(e=>{});
  await page.waitForTimeout(600);
  const name = (r||"home");
  await page.screenshot({ path: out+"/"+name+".png", fullPage:false });
  const m = await page.evaluate(()=>({
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    title: document.title,
    hasIdea: !!document.querySelector(".idea,#idea,.claim,.forms"),
    traceVisible: (document.getElementById("trace")||{}).style?.opacity === "1"
  }));
  report.push({route:r||"/", ...m});
}
await browser.close();
console.log(JSON.stringify(report,null,1));
