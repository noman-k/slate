import { CORS_HEADERS, isAllowedRedirectUri } from "@/lib/oauth";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { anonSupabase } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";

/**
 * Dynamic Client Registration (RFC 7591): an app registers itself before sending someone to
 * connect it. Apps are public clients (no secret); PKCE protects the code they get back.
 * Registering grants nothing: the person still signs in and allows it.
 */
const headers = { ...CORS_HEADERS, "Cache-Control": "no-store" };
const fail = (status: number, error: string, error_description: string) =>
  Response.json({ error, error_description }, { status, headers });

export async function POST(request: Request) {
  const limited = await rateLimit("OAUTH_LIMITER", clientAddress(request));
  if (!limited.ok)
    return fail(
      429,
      "too_many_requests",
      `Too many registrations from this address. Wait ${limited.retryAfter} seconds.`,
    );
  const supabase = anonSupabase();
  if (!supabase) return fail(503, "temporarily_unavailable", "Slate is not connected to Supabase.");
  const raw = await request.text();
  if (raw.length > 20_000) return fail(413, "invalid_client_metadata", "That registration is too large.");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_client_metadata", "Send the registration as JSON.");
  }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10)
    return fail(400, "invalid_redirect_uri", "Give between 1 and 10 redirect_uris.");
  const bad = uris.find((uri) => !isAllowedRedirectUri(uri));
  if (bad !== undefined)
    return fail(
      400,
      "invalid_redirect_uri",
      `Not an allowed redirect URI: ${String(bad).slice(0, 200)}. Use https, http on localhost, or an app's own scheme.`,
    );
  const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"];
  if (grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token"))
    return fail(400, "invalid_client_metadata", "Only the authorization_code and refresh_token grants are supported.");
  const name = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 100) : "";
  const { data, error } = await supabase.rpc("oauth_register_client", { p_name: name, p_redirect_uris: uris });
  if (error || typeof data !== "string")
    return fail(503, "temporarily_unavailable", "Couldn’t register the app just now. Try again.");
  return Response.json(
    {
      client_id: data,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name || "An AI app",
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers },
  );
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
