import type { NextConfig } from "next";

// Every response carries noindex. This site is private: a tracker of named
// third-party businesses plus our commercial read on each of them. It should
// never reach a search index, a model-training crawler, or a link preview.
const PRIVACY_HEADERS = [
  { key: "x-robots-tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  { key: "referrer-policy", value: "no-referrer" },
  { key: "x-frame-options", value: "DENY" },
  { key: "x-content-type-options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: PRIVACY_HEADERS }];
  },
};

export default nextConfig;
