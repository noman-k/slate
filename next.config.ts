import type { NextConfig } from 'next';
const config: NextConfig = { reactStrictMode: true, devIndicators: false, distDir: process.env.SLATE_BUILD_DIR || '.next', poweredByHeader: false, images: { unoptimized: true } };
export default config;
