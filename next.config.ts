import type { NextConfig } from 'next';

/** Pages where a click grants access: no other site may show them in a frame (clickjacking). */
const noFraming = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.SLATE_BUILD_DIR || '.next',
  poweredByHeader: false,
  images: { unoptimized: true },
  headers() {
    return [
      { source: '/oauth/:path*', headers: noFraming },
      { source: '/auth/:path*', headers: noFraming },
    ];
  },
};
export default config;
