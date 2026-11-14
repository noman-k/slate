import { hashAgentKey } from '@/lib/agent-keys';
import { ACCESS_TOKEN_SECONDS, CORS_HEADERS, newAccessToken, newRefreshToken } from '@/lib/oauth';
import { clientAddress, rateLimit } from '@/lib/rate-limit';
import { anonSupabase } from '@/lib/supabase/anon';

export const dynamic = 'force-dynamic';

/**
 * The token endpoint: an app swaps the code it was given (with its PKCE verifier) for an
 * access token and a refresh token, and later a refresh token for new ones. Codes work once;
 * refresh tokens are replaced each time; both stop working when the connection is revoked.
 */
const headers = { ...CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const fail = (status: number, error: string, error_description: string) =>
  Response.json({ error, error_description }, { status, headers });

/** Form-encoded, as OAuth specifies; JSON is accepted too. */
async function readParams(request: Request): Promise<Record<string, string>> {
  const raw = await request.text();
  if (raw.length > 10_000) return {};
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(json).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export async function POST(request: Request) {
  const limited = await rateLimit('OAUTH_LIMITER', clientAddress(request));
  if (!limited.ok) return fail(429, 'slow_down', `Too many token requests from this address. Wait ${limited.retryAfter} seconds.`);
  const supabase = anonSupabase();
  if (!supabase) return fail(503, 'temporarily_unavailable', 'Slate is not connected to Supabase.');
  const params = await readParams(request);
  // A public client names itself; one that sends Basic credentials is read from those.
  let clientId = params.client_id || '';
  const basic = (request.headers.get('authorization') || '').match(/^Basic\s+(.+)$/i);
  if (!clientId && basic) {
    try {
      clientId = decodeURIComponent(atob(basic[1]).split(':')[0] || '');
    } catch {}
  }
  if (!clientId) return fail(400, 'invalid_request', 'Missing client_id.');

  const access = newAccessToken();
  const refresh = newRefreshToken();
  const issued = (scope: string) =>
    Response.json(
      { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh, scope },
      { headers },
    );

  if (params.grant_type === 'authorization_code') {
    if (!params.code || !params.redirect_uri || !params.code_verifier)
      return fail(400, 'invalid_request', 'Send code, redirect_uri and code_verifier.');
    const { data, error } = await supabase.rpc('oauth_exchange_code', {
      p_code_hash: await hashAgentKey(params.code),
      p_client_id: clientId,
      p_redirect_uri: params.redirect_uri,
      p_code_verifier: params.code_verifier,
      p_access_hash: await hashAgentKey(access),
      p_refresh_hash: await hashAgentKey(refresh),
    });
    if (error) return fail(503, 'temporarily_unavailable', 'Couldn’t issue a token just now. Try again.');
    const result = data as { scope?: string; error?: string };
    if (result.error || !result.scope)
      return fail(400, 'invalid_grant', 'That code is not valid, was already used, or has expired. Connect again.');
    return issued(result.scope);
  }
  if (params.grant_type === 'refresh_token') {
    if (!params.refresh_token) return fail(400, 'invalid_request', 'Send refresh_token.');
    const { data, error } = await supabase.rpc('oauth_refresh', {
      p_refresh_hash: await hashAgentKey(params.refresh_token),
      p_client_id: clientId,
      p_access_hash: await hashAgentKey(access),
      p_new_refresh_hash: await hashAgentKey(refresh),
    });
    if (error) {
      if (/invalid_grant/.test(error.message))
        return fail(400, 'invalid_grant', 'That refresh token is not valid, or the connection was revoked. Connect again.');
      return fail(503, 'temporarily_unavailable', 'Couldn’t issue a token just now. Try again.');
    }
    return issued((data as { scope: string }).scope);
  }
  return fail(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
