#!/usr/bin/env node
/**
 * deai-check.mjs — quick AI-pattern check for a file (plain Node, no build).
 *
 * Usage:  node scripts/deai-check.mjs <file>
 * Prints: type detected, AI score (0-1), verdict, and the signals found.
 *
 * Use it BEFORE and AFTER a change to prove the change reduced AI patterns.
 * Honest limit: catches sloppy/cliche AI patterns, not natural-sounding AI.
 */
import { readFileSync } from "fs";
import { extname } from "path";

const EN = ["delve","tapestry","navigate the","unlock","unleash","elevate","seamless","robust","leverage","foster","underscore","pivotal","realm","landscape","in today's fast-paced","it's worth noting","furthermore","moreover","additionally","a testament to","sheds light","embark on a journey","harness","cutting-edge","game-changer","streamline","holistic","paradigm","in conclusion","plays a crucial role","a wide range of"];
const HE = ["חשוב לציין","יתרה מזאת","בנוסף לכך","בעולם של היום","בסופו של דבר","ניתן לראות","ראוי לציין","מדובר ב","בעידן המודרני","בעולם המודרני","אין ספק ש","מגוון רחב","שילוב של","חוויה ייחודית","פתרונות חדשניים","פורץ דרך","מהפכני","חדשני"];

function textScore(t){
  if(!t || t.length<50) return {score:0,signals:[]};
  let s=0, sig=[]; const low=t.toLowerCase();
  const en=EN.filter(c=>low.includes(c)).length;
  if(en>=2){sig.push("en_cliches:"+en); s+=Math.min(0.45,en*0.12);}
  const he=HE.filter(c=>t.includes(c)).length;
  if(he>=2){sig.push("he_cliches:"+he); s+=Math.min(0.45,he*0.12);}
  const cc=(t.match(/not\s+(?:just|only|merely|simply)\s+[^,.]{2,40}?\s+but/gi)||[]).length
         + (t.match(/לא\s+(?:רק|עוד)\s+[^,.]{2,40}?\s+(?:אלא|כי אם)/gi)||[]).length;
  if(cc>=1){sig.push("contrast:"+cc); s+=Math.min(0.25,cc*0.12);}
  return {score:Math.min(1,s),signals:sig};
}

function codeScore(c){
  if(!c||c.length<50) return {score:0,signals:[]};
  let s=0,sig=[]; const lc=c.split("\n").length;
  const con=(c.match(/console\.(log|debug|trace)\(/g)||[]).length;
  if(con>=2){sig.push("console:"+con); s+=Math.min(0.3,con*0.1);}
  const todo=(c.match(/\b(TODO|FIXME|HACK|XXX)\b/g)||[]).length;
  if(todo>=1){sig.push("todo:"+todo); s+=Math.min(0.2,todo*0.1);}
  const ph=(c.match(/lorem|ipsum|example\.com|placeholder|dummy|changeme/gi)||[]).length;
  if(ph>=1){sig.push("placeholders:"+ph); s+=Math.min(0.3,ph*0.15);}
  return {score:Math.min(1,s),signals:sig};
}

function cssScore(css){
  if(!css||css.length<50) return {score:0,signals:[]};
  let s=0,sig=[];
  const g=(css.match(/backdrop-filter\s*:\s*blur\(/gi)||[]).length;
  if(g>=2){sig.push("glassmorphism:"+g); s+=Math.min(0.3,g*0.1);}
  const gr=(css.match(/linear-gradient\(/gi)||[]).length;
  if(gr>=5){sig.push("gradients:"+gr); s+=Math.min(0.2,gr*0.03);}
  return {score:Math.min(1,s),signals:sig};
}

const file = process.argv[2];
if(!file){ console.log("Usage: node scripts/deai-check.mjs <file>"); process.exit(1); }
const content = readFileSync(file, "utf-8");
const ext = extname(file).toLowerCase();

let type, res;
if([".css",".scss",".less"].includes(ext)){ type="css"; res=cssScore(content); }
else if([".ts",".tsx",".js",".jsx",".py",".go",".rs"].includes(ext)){ type="code"; res=codeScore(content); }
else { type="text"; res=textScore(content); }

const verdict = res.score>=0.4 ? "ai_likely" : res.score>=0.2 ? "uncertain" : "human_likely";
console.log(`file: ${file}`);
console.log(`type: ${type}`);
console.log(`score: ${res.score.toFixed(2)}`);
console.log(`verdict: ${verdict}`);
console.log(`signals: ${res.signals.join(", ") || "none"}`);
