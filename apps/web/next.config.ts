import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ecochef/api-client", "@ecochef/contracts", "@ecochef/design-tokens"],
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://stripe.com https://*.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' http://localhost:* http://127.0.0.1:* https://stripe.com https://*.stripe.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com",
      "frame-src 'self' https://stripe.com https://*.stripe.com https://*.firebaseapp.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join("; ");
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
