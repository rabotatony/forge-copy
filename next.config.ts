import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize typescript so it is not bundled for Workers.
  serverExternalPackages: ["typescript", "sharp"],
  turbopack: {
    externalPackages: ["typescript", "sharp"],
  },
  reactStrictMode: false,
  // Externalize typescript so Turbopack does not bundle it for Workers.
  serverExternalPackages: ["typescript", "sharp"],
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
