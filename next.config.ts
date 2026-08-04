import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config: any) => {
    config.externals = [...(config.externals || []), "typescript"];
    return config;
  },
  serverExternalPackages: ["typescript"],
  reactStrictMode: false,
  // standalone output so the Docker container can run .next/standalone/server.js
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  // Forge runs real child processes (spawn) and uses Node APIs (fs, crypto,
  // readline) that are unavailable in the Edge runtime. Force the Node
  // runtime for all server-side code by leaving the default runtime.
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
