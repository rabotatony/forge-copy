import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
