import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleMcpMessage } from "@/lib/mcp";
import { ToolError } from "@/lib/agent-tools";
import { hashAgentKey, looksLikeAgentKey } from "@/lib/agent-keys";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { CORS_HEADERS, requestOrigin, resourceMetadataUrl } from "@/lib/oauth";
import type { WorkspaceState } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Slate's MCP endpoint: an AI agent connects here with an agent key (made in Settings ›
 * AI agents) or an OAuth access token (an app the person connected by signing in; see
 * src/lib/oauth.ts), and gets tools over one of that person's workspaces: reading for every key, creating
 * pages, databases and playbooks for keys allowed to, and editing them for keys allowed to edit. Stateless JSON over
 * Streamable HTTP: one JSON-RPC message per POST.
 */
const headers = { ...CORS_HEADERS, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
/** Points apps at how to connect (sign in with OAuth), per the MCP authorization spec. */
const challenge = (request: Request, error?: string) =>
  `Bearer resource_metadata="${resourceMetadataUrl(requestOrigin(request))}"${error ? `, error="${error}"` : ""}`;
const MAX_BODY = 100_000;

function rpcError(status: number, message: string, extra: Record<string, string> = {}) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message } },
    { status, headers: { ...headers, ...extra } },
  );
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return rpcError(503, "Agent access needs a Slate workspace with Supabase connected.");
  const key = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!looksLikeAgentKey(key))
    return rpcError(
      401,
      "Connect this app by signing in to Slate, or send an agent key: Authorization: Bearer slate_… (create one in Settings › AI agents).",
      { "WWW-Authenticate": challenge(request) },
    );
  const raw = await request.text();
  if (raw.length > MAX_BODY) return rpcError(413, "That request is too large.");
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers },
    );
  }
  // Limits come before the key is looked up, so made-up keys can't flood the database:
  // per address for everything, and per key for each agent.
  const keyHash = await hashAgentKey(key);
  for (const [limiter, subject, who] of [
    ["MCP_IP_LIMITER", clientAddress(request), "from this address"],
    ["MCP_KEY_LIMITER", keyHash, "for this key"],
  ] as const) {
    const limited = await rateLimit(limiter, subject);
    if (!limited.ok)
      return rpcError(
        429,
        `Too many requests ${who}: at most ${limited.limit} a minute. Wait ${limited.retryAfter} seconds, then try again.`,
        { "Retry-After": String(limited.retryAfter) },
      );
  }
  // Check the key (and load the workspace) before answering anything.
  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("agent_workspace_state", { p_key_hash: keyHash });
  if (error) {
    if (/invalid agent key/i.test(error.message))
      return rpcError(401, "This agent key or token is not valid, has expired, or was revoked.", {
        "WWW-Authenticate": challenge(request, "invalid_token"),
      });
    return rpcError(503, "Unable to read the workspace right now. Try again.");
  }
  const { agent, ...snapshot } = data as WorkspaceState & { agent?: { scope?: string }; revision?: number };
  const state = snapshot as WorkspaceState;
  if (!state.active_workspace_id) state.active_workspace_id = state.workspaces?.[0]?.id ?? "";
  // Links to what an agent creates use the address it called (slate.noman.io, a preview, localhost).
  const origin = requestOrigin(request);
  try {
    const reply = await handleMcpMessage(message, {
      load: async () => state,
      scope: agent?.scope === "edit" ? "edit" : agent?.scope === "write" ? "write" : "read",
      create: async (planned) => {
        const limited = await rateLimit("MCP_WRITE_LIMITER", keyHash);
        if (!limited.ok)
          throw new ToolError(
            `This key has created a lot in the last minute (at most ${limited.limit}). Nothing was created; wait ${limited.retryAfter} seconds, then try again.`,
          );
        const { error: failed } = await supabase.rpc("agent_create", {
          p_key_hash: keyHash,
          p_creation: planned.creation,
        });
        if (failed) {
          if (/can only read/i.test(failed.message)) throw new ToolError("This agent key can only read.");
          if (/invalid agent key/i.test(failed.message))
            throw new ToolError("This agent key or token is not valid, has expired, or was revoked.");
          if (/workspace|page|databases can be filled/i.test(failed.message))
            throw new ToolError(`That can't be created here: ${failed.message}.`);
          throw new ToolError("Slate couldn’t save that just now. Nothing was created; try again in a moment.");
        }
        return `${origin}/p/${planned.pageId}`;
      },
      edit: async (planned) => {
        const limited = await rateLimit("MCP_WRITE_LIMITER", keyHash);
        if (!limited.ok)
          throw new ToolError(
            `This key has made a lot of changes in the last minute (at most ${limited.limit}). Nothing was changed; wait ${limited.retryAfter} seconds, then try again.`,
          );
        const { error: failed } = await supabase.rpc("agent_update", { p_key_hash: keyHash, p_edit: planned.edit });
        if (failed) {
          if (/can't edit/i.test(failed.message)) throw new ToolError("This agent key can’t change existing pages.");
          if (/invalid agent key/i.test(failed.message))
            throw new ToolError("This agent key or token is not valid, has expired, or was revoked.");
          if (/changed since it was read/i.test(failed.message))
            throw new ToolError(
              "Someone changed that page since you read it. Nothing was changed; read it again and redo the edit.",
            );
          if (/workspace/i.test(failed.message)) throw new ToolError(`That can't be changed here: ${failed.message}.`);
          throw new ToolError("Slate couldn’t save that just now. Nothing was changed; try again in a moment.");
        }
        return `${origin}/p/${planned.pageId}`;
      },
    });
    return reply.body
      ? NextResponse.json(reply.body, { status: reply.status, headers })
      : new Response(null, { status: reply.status, headers });
  } catch {
    return rpcError(500, "Something went wrong reading the workspace.");
  }
}

/** No server-to-agent stream: this server only answers requests. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { ...headers, Allow: "POST" } });
}
export const DELETE = GET;
/** Browser-based MCP clients ask first. */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
