import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site-origin";

/** Search engines may read the public pages; the app, sign-in and APIs aren't for them. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/p/", "/auth/", "/oauth/", "/api/"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
