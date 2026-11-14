import { CORS_HEADERS, protectedResourceMetadata, requestOrigin } from '@/lib/oauth';

/**
 * Where an app learns how to get access to Slate's MCP endpoint (RFC 9728). Served at
 * /.well-known/oauth-protected-resource and, for apps that add the endpoint's path,
 * /.well-known/oauth-protected-resource/api/mcp.
 */
export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(requestOrigin(request)), {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' },
  });
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
