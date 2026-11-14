import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleMcpMessage } from '@/lib/mcp';
import { hashAgentKey, looksLikeAgentKey } from '@/lib/agent-keys';
import { clientAddress, rateLimit } from '@/lib/rate-limit';
import type { WorkspaceState } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Slate's MCP endpoint: an AI agent connects here with an agent key (made in Settings ›
 * AI agents) and gets read-only tools over that person's workspace. Stateless JSON over
 * Streamable HTTP: one JSON-RPC message per POST.
 */
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_BODY = 100_000;

function rpcError(status: number, message: string, extra: Record<string, string> = {}) {
  return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }, { status, headers: { ...headers, ...extra } });
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return rpcError(503, 'Agent access needs a Slate workspace with Supabase connected.');
  const key = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!looksLikeAgentKey(key))
    return rpcError(401, 'Add an agent key: Authorization: Bearer slate_… (create one in Settings › AI agents).', { 'WWW-Authenticate': 'Bearer' });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return rpcError(413, 'That request is too large.');
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers });
  }
  // Limits come before the key is looked up, so made-up keys can't flood the database:
  // per address for everything, and per key for each agent.
  const keyHash = await hashAgentKey(key);
  for (const [limiter, subject, who] of [
    ['MCP_IP_LIMITER', clientAddress(request), 'from this address'],
    ['MCP_KEY_LIMITER', keyHash, 'for this key'],
  ] as const) {
    const limited = await rateLimit(limiter, subject);
    if (!limited.ok)
      return rpcError(429, `Too many requests ${who}: at most ${limited.limit} a minute. Wait ${limited.retryAfter} seconds, then try again.`, { 'Retry-After': String(limited.retryAfter) });
  }
  // Check the key (and load the workspace) before answering anything.
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('agent_workspace_state', { p_key_hash: keyHash });
  if (error) {
    if (/invalid agent key/i.test(error.message))
      return rpcError(401, 'This agent key is not valid, or was revoked.', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    return rpcError(503, 'Unable to read the workspace right now. Try again.');
  }
  const state = data as WorkspaceState;
  if (!state.active_workspace_id) state.active_workspace_id = state.workspaces?.[0]?.id ?? '';
  try {
    const reply = await handleMcpMessage(message, async () => state);
    return reply.body ? NextResponse.json(reply.body, { status: reply.status, headers }) : new Response(null, { status: reply.status, headers });
  } catch {
    return rpcError(500, 'Something went wrong reading the workspace.');
  }
}

/** No server-to-agent stream: this server only answers requests. */
export function GET() {
  return new Response('Method Not Allowed', { status: 405, headers: { ...headers, Allow: 'POST' } });
}
export const DELETE = GET;
