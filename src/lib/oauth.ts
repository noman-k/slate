/**
 * Connecting an app to Slate with OAuth (the MCP authorization spec): an app such as
 * Claude, ChatGPT or Codex is given Slate's MCP address, finds out from the 401 and the
 * /.well-known documents where to send people, registers itself, and sends the person to
 * /oauth/authorize. There they sign in, choose a workspace and what the app may do, and
 * allow it. The app swaps the code it gets back (with its PKCE verifier) for tokens at
 * /api/oauth/token.
 *
 * Tokens look like agent keys ("slate_at_…", "slate_rt_…") and are stored only as hashes,
 * like keys. Each connection shows in Settings › AI agents, where it can be revoked.
 */
import { generateAgentKey } from "./agent-keys";

/** What an app may be allowed to do; the same choices as agent keys. */
export const OAUTH_SCOPES = ["read", "write", "edit"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** Seconds an access token lasts (the database sets the same hour). */
export const ACCESS_TOKEN_SECONDS = 3600;

/** Random secrets: same alphabet and length as agent keys, with a telling prefix. */
const secret = (kind: "at" | "rt" | "code") =>
  generateAgentKey()
    .replace(/^slate_/, `slate_${kind}_`)
    .slice(0, 52);
export const newAccessToken = () => secret("at");
export const newRefreshToken = () => secret("rt");
export const newAuthorizationCode = () => secret("code");

/**
 * The address the request came in on (slate.noman.io, a preview, localhost): the issuer and
 * every URL in the metadata use it, so discovery works wherever Slate runs.
 */
export function requestOrigin(request: Request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const mcpResource = (origin: string) => `${origin}/api/mcp`;
export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;

/** RFC 9728: which server protects the MCP endpoint. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    resource_name: "Slate",
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/docs/mcp`,
  };
}

/** RFC 8414: where apps register, send people, and get tokens. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${origin}/docs/mcp`,
  };
}

/** Schemes that must never be a return address (they'd run or read something locally). */
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:", "filesystem:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether an app may register this return address: https anywhere, http only back to the
 * same computer (desktop and command-line apps), or an app's own scheme (cursor://, vscode://).
 * Never with a fragment.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || value.includes("#")) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !UNSAFE_SCHEMES.has(url.protocol);
}

/** The return address with the code (or an error) added, keeping its own query. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value);
  return url.toString();
}

/** A short, readable name for where the app sends people back to ("claude.ai", "Cursor"). */
export function returnPlace(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === "https:") return url.hostname;
    if (url.protocol === "http:") return "an app on this computer";
    return `the ${url.protocol.replace(":", "")} app`;
  } catch {
    return "the app";
  }
}

/** The PKCE challenge for a verifier (S256), as the app would compute it. */
export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** CORS for the endpoints apps call from anywhere (no cookies are involved). */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};
