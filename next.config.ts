import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize typescript so Turbopack does not bundle it for Workers.
  serverExternalPackages: ["typescript", "sharp"],
  turbopack: {
    externalPackages: ["typescript", "sharp"],
  },
  // Externalize typescript so Turbopack does not bundle it for Workers.
  serverExternalPackages: ["typescript", "sharp"],
  turbopack: {
    externalPackages: ["typescript", "sharp"],
  },
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    turbo: false,
    serverActions: { bodySizeLimit: "50mb" },
  },
  webpack: (config: any) => {
    config.externals = [...(config.externals || []), "typescript"];
    return config;
  },
};

export default nextConfig;
