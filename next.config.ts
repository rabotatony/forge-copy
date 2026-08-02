import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Forge runs real child processes (spawn) and uses Node APIs (fs, crypto,
  // readline) that are unavailable in the Edge runtime. Force the Node
  // runtime for all server-side code by leaving the default runtime.
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
