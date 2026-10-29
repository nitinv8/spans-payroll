/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/api/mcp", destination: "/api/mcp/metadata" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/mcp/metadata" },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }];
  },
};
export default nextConfig;
