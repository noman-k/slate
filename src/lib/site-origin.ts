import { headers } from "next/headers";
import { SITE_URL } from "./project";

/**
 * The address this request came in on (slate.noman.io, a self-hosted copy, localhost), so
 * the sitemap and robots.txt name pages where they're actually served.
 */
export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  if (!host) return SITE_URL;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") || (local ? "http" : "https");
  return `${proto}://${host}`;
}
