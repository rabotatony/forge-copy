import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Forge on Cloudflare Workers via OpenNext.
// Bindings (D1 = DB, R2 = STORAGE) are defined in wrangler.jsonc.
// Externalize node-only modules that cannot be bundled for Workers.
export default defineCloudflareConfig({
  openNext: {
    build: {
      override: {
        esbuild: {
          external: ["typescript"],
        },
      },
    },
  },
});
