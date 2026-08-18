import type { NextConfig } from "next";

/**
 * One rule: serve over https. A page loaded over plain http (a proxy in
 * front that does not redirect) would then call /api/rpc, get bounced to
 * https, and the browser refuses the bounce as cross-origin, so every read
 * fails while the wallet chip looks connected. Redirect the page instead,
 * once, at the door. Localhost is left alone.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          { type: "header", key: "x-forwarded-proto", value: "http" },
          { type: "host", value: "(?<host>(?!localhost|127\\.0\\.0\\.1).*)" },
        ],
        destination: "https://:host/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
