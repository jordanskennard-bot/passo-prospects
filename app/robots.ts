import type { MetadataRoute } from "next";

// Nothing here is for a crawler. Paired with the x-robots-tag header set on
// every response in next.config.ts.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
