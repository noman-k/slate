import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site-origin";

/**
 * The public pages, for search engines. Workspaces, pages and records are private (each
 * person's own, behind sign-in), so they're never listed.
 */
const PUBLIC_PAGES = [
  { path: "/", priority: 1 },
  { path: "/docs/mcp", priority: 0.8 },
  { path: "/contact", priority: 0.4 },
  { path: "/privacy", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  return PUBLIC_PAGES.map(({ path, priority }) => ({ url: `${origin}${path === "/" ? "" : path}`, priority }));
}
