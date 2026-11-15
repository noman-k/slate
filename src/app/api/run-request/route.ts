import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  HTTP_METHODS,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  parseHeaders,
  urlProblem,
  type ApiRequest,
} from "@/lib/api-request";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const answer = (data: object, status = 200) => NextResponse.json(data, { status, headers: privateHeaders });
const failure = (error: string, status: number) => answer({ status: 0, ok: false, body: "", error }, status);

/** Headers that describe this hop, or would let a caller borrow someone else's identity. */
const DROPPED = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-connection",
  "cookie",
  "origin",
  "referer",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
]);
const MAX_REQUEST_BYTES = 200_000;

/** Reads at most `limit` bytes of a response body. */
async function readCapped(response: Response, limit: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.min(chunk.byteLength, all.byteLength - offset));
    all.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * Sends an API step's request for a signed-in person (so APIs that don't allow
 * browser calls still work). Only public http(s) addresses are allowed, redirects
 * aren't followed, no cookies or forwarding headers are passed on, and requests and
 * responses are size- and time-limited.
 */
export async function POST(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return failure("Sending requests through Slate is not configured.", 503);
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return failure("That request is too large to send.", 413);
  let userId: string;
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return failure("Sign in to send requests.", 401);
    userId = user.id;
  } catch {
    return failure("Unable to check your session. Try again.", 503);
  }
  // Each person can send a limited number of requests a minute, so Slate can't be used to flood other sites.
  const limited = await rateLimit("RUN_REQUEST_LIMITER", userId);
  if (!limited.ok)
    return NextResponse.json(
      {
        status: 0,
        ok: false,
        body: "",
        error: `Slate sends at most ${limited.limit} requests a minute for you. Wait ${limited.retryAfter} seconds, then try again.`,
      },
      { status: 429, headers: { ...privateHeaders, "Retry-After": String(limited.retryAfter) } },
    );
  let input: ApiRequest;
  try {
    input = JSON.parse(raw) as ApiRequest;
  } catch {
    return failure("That request could not be read.", 400);
  }
  const method = String(input?.method || "").toUpperCase();
  if (!HTTP_METHODS.includes(method as ApiRequest["method"])) return failure("That method is not supported.", 400);
  const url = String(input?.url || "");
  const problem = urlProblem(url, { allowPrivate: process.env.NODE_ENV !== "production" });
  if (problem) return failure(problem, 400);
  const headers = new Headers();
  const pairs = Array.isArray(input.headers) ? input.headers : parseHeaders(String(input.headers || ""));
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [name, value] = pair.map(String);
    if (DROPPED.has(name.toLowerCase())) continue;
    try {
      headers.set(name, value);
    } catch {
      return failure(`The header “${name}” isn't valid.`, 400);
    }
  }
  headers.set("User-Agent", "Slate-Runbook/1.0");
  const body = method === "GET" || input.body === undefined ? undefined : String(input.body);
  try {
    const upstream = await fetch(url, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await readCapped(upstream, MAX_RESPONSE_BYTES);
    const redirectTo = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get("location") : null;
    return answer({
      status: upstream.status,
      ok: upstream.ok,
      body: text,
      ...(redirectTo ? { error: `The API redirected to ${redirectTo}. Use that address instead.` } : {}),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return answer({
      status: 0,
      ok: false,
      body: "",
      error: timedOut
        ? `No answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
        : "Couldn’t reach the API. Check the address.",
    });
  }
}
