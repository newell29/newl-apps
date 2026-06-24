import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  experimental: {
    devtoolSegmentExplorer: false
  }
};

export default nextConfig;
