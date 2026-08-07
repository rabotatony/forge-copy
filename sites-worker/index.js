export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let key = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!key) return new Response("Forge Sites — deploy something via POST /api/forge/sites", { status: 200 });
    if (key.endsWith("/")) key += "index.html";
    const obj = await env.STORAGE.get(key);
    if (!obj) {
      const idx = await env.STORAGE.get(key.replace(/\/?$/, "/index.html"));
      if (idx) return respond(idx, "index.html");
      return new Response("Not found", { status: 404 });
    }
    return respond(obj, key);
  },
};
function respond(obj, key) {
  const types = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", json: "application/json", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon", txt: "text/plain", woff2: "font/woff2" };
  const ext = key.includes(".") ? key.split(".").pop() : "html";
  return new Response(obj.body, { headers: { "Content-Type": types[ext] || "application/octet-stream" } });
}
