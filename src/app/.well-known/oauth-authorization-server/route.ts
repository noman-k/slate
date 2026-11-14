import { authorizationServerMetadata, CORS_HEADERS, requestOrigin } from '@/lib/oauth';

/** Slate's OAuth details for apps that connect to its MCP endpoint (RFC 8414). */
export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(requestOrigin(request)), {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' },
  });
}
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
