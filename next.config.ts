import type { NextConfig } from "next";

// ============================================================
// Forge — Next.js config (dual-target)
// ============================================================
// Self-hosted / Docker builds (bun run build) NEED standalone
// output — .next/standalone/server.js is what bootstrap-forge.sh,
// the Dockerfile and `bun run start` all execute.
//
// Cloudflare builds (opennextjs-cloudflare build) must NOT use
// standalone output — OpenNext produces its own worker bundle.
// CI and build:cf set FORGE_BUILD_TARGET=cloudflare to select that mode.
// ============================================================
const isCloudflareBuild = process.env.FORGE_BUILD_TARGET === "cloudflare";

const nextConfig: NextConfig = {
  // Keep heavy Node-only packages out of the Workers bundle (defensive —
  // Forge itself no longer imports `typescript` on the server).
  serverExternalPackages: ["typescript", "sharp"],
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

if (!isCloudflareBuild) {
  nextConfig.output = "standalone";
}

export default nextConfig;
