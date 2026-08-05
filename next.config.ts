import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack, use webpack (webpack respects externals properly)
  experimental: {
    turbo: false,
  },
  webpack: (config: any) => {
    config.externals = [...(config.externals || []), "typescript"];
    return config;
  },
  webpack: (config: any) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias["typescript"] = false;
    return config;
  },
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
