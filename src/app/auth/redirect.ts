/**
 * A redirect that stays on the address the visitor is using. `request.url` can name the
 * server's bind address instead (http://0.0.0.0:3000 under `next dev --hostname 0.0.0.0`),
 * which the browser treats as another site, so the session cookies just set would be lost.
 * A relative Location is resolved by the browser against the page it is on.
 */
export function redirectTo(path: string, status: 302 | 303 = 303) {
  return new Response(null, { status, headers: { Location: path, 'Cache-Control': 'private, no-store' } });
}
