import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Heavy native / server-only packages stay outside the bundle.
  serverExternalPackages: ["sharp", "playwright-core", "pg", "pixelmatch", "pngjs", "jszip", "@aws-sdk/client-s3"],
  poweredByHeader: false,
  // Generated sites may link to folder-style URLs ("/journal/"); serve them as authored.
  skipTrailingSlashRedirect: true,
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  async headers() {
    return [
      {
        source: "/((?!preview|s/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
