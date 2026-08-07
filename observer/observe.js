#!/usr/bin/env node
// ============================================================
// Forge Observer — the AI's "eyes" (headless-browser perception)
// ============================================================
// Instead of a flat screenshot, captures a rich SEMANTIC view of a
// running page that an AI can actually perceive:
//   • accessibility snapshot (the page as a readable tree)
//   • console logs + network requests (what the app is doing)
//   • dynamic state: videos, animations, transitions
//   • screenshot (for humans) and video recording (for motion)
//
// Usage: node observe.js <url> [mode] [recordMs]
//   mode: semantic | screenshot | video   (default: semantic)
// Prints one JSON object to stdout.
// ============================================================
const { chromium } = require("playwright");

(async () => {
  const url = process.argv[2];
  const mode = process.argv[3] || "semantic";
  const recordMs = Number(process.argv[4] || 3000);
  if (!url) { console.log(JSON.stringify({ error: "url required" })); process.exit(1); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: mode === "video" ? { dir: "/tmp/forge-observe", size: { width: 1280, height: 900 } } : undefined,
  });
  const page = await ctx.newPage();

  const logs = [];
  const net = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("request", (r) => net.push(`${r.method()} ${r.url().slice(0, 120)}`));

  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch((e) => logs.push(`[goto] ${e.message}`));
  await page.waitForTimeout(mode === "video" ? recordMs : 1200);

  let aria = "";
  try { aria = await page.locator("body").ariaSnapshot(); } catch { aria = ""; }

  const dynamic = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")].map((v) => ({
      src: (v.currentSrc || v.src || "").split("/").pop(), playing: !v.paused, time: v.currentTime, dur: v.duration,
    }));
    let animating = 0; const animNames = new Set();
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== "none") { animating++; animNames.add(cs.animationName); }
    });
    return { videos: vids, animatingElements: animating, animations: [...animNames].slice(0, 10), title: document.title, url: location.href };
  });

  const out = { url, mode, dynamic, console: logs.slice(0, 40), network: net.slice(0, 40), aria: aria.slice(0, 6000) };

  if (mode === "screenshot" || mode === "video") {
    out.screenshotBase64 = (await page.screenshot({ fullPage: false })).toString("base64").slice(0, 800000);
  }

  await page.close();
  if (mode === "video") {
    try {
      const video = page.video();
      if (video) { const p = await video.path(); out.videoFile = p; }
    } catch {}
  }
  await ctx.close(); await browser.close();
  console.log(JSON.stringify(out));
})();
