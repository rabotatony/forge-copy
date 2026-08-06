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
  //
  // Prisma MUST stay external on Cloudflare builds: bundling @prisma/client
  // into the worker makes it load its query engine via fs ("[unenv]
  // fs.readdir is not implemented yet!"). Kept external, OpenNext resolves
  // the workerd-condition build from node_modules and model queries work.
  // (opennextjs-cloudflare#623, prisma/prisma#27041)
  serverExternalPackages: [
    "typescript",
    "sharp",
    "@prisma/client",
    "@prisma/adapter-d1",
    ".prisma/client",
  ],
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
