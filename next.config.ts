import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
  },
};

export default nextConfig;
