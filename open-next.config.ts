import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Forge on Cloudflare Workers via OpenNext.
// Bindings (D1 = DB, R2 = STORAGE) are defined in wrangler.jsonc.
export default defineCloudflareConfig({
  // Externalize node-only packages that cannot be bundled for Workers.
  // react-syntax-highlighter pulls in `typescript` for syntax highlighting,
  // which Turbopack cannot bundle for the Workers runtime.
  edgeExternals: ["typescript", "sharp"],
});
