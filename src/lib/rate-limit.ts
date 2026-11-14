/**
 * Rate limits for the endpoints that do work on someone's behalf: /api/run-request (sends an
 * HTTP request) and /api/mcp (reads a workspace for an AI agent).
 *
 * In production they use Cloudflare's Rate Limiting bindings, declared in wrangler.jsonc.
 * Cloudflare counts per location and approximately, which is what these limits need: stop
 * floods, never get in the way of normal use. Under `next dev` there are no bindings, so a
 * small in-memory counter stands in with the same limits.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

export type LimiterName = "RUN_REQUEST_LIMITER" | "MCP_KEY_LIMITER" | "MCP_IP_LIMITER" | "CONTACT_LIMITER";

/** Requests per minute. Keep in step with "ratelimits" in wrangler.jsonc. */
export const LIMITS: Record<LimiterName, number> = {
  RUN_REQUEST_LIMITER: 30,
  MCP_KEY_LIMITER: 120,
  MCP_IP_LIMITER: 300,
  // The contact form, per IP address.
  CONTACT_LIMITER: 5,
};
export const PERIOD_SECONDS = 60;

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitResult {
  ok: boolean;
  /** The limit that applied, in requests a minute. */
  limit: number;
  /** Seconds to wait before trying again (for the Retry-After header). */
  retryAfter: number;
}

/**
 * Limits under `next dev`. SLATE_DEV_RATE_LIMITS (e.g. "RUN_REQUEST_LIMITER=5") lowers them,
 * so tests can reach a limit quickly. It has no effect where Cloudflare's bindings exist.
 */
function devLimit(name: LimiterName) {
  const override = (process.env.SLATE_DEV_RATE_LIMITS || "")
    .split(",")
    .map((pair) => pair.split("="))
    .find(([key]) => key?.trim() === name);
  const value = Number(override?.[1]);
  return Number.isFinite(value) && value > 0 ? value : LIMITS[name];
}

const windows = new Map<string, { start: number; count: number }>();

/** A fixed one-minute window per key, kept in this process's memory. */
export function countLocally(name: LimiterName, key: string, limit = devLimit(name), now = Date.now()): RateLimitResult {
  const id = `${name}:${key}`;
  const period = PERIOD_SECONDS * 1000;
  let entry = windows.get(id);
  if (!entry || now - entry.start >= period) {
    entry = { start: now, count: 0 };
    windows.set(id, entry);
    // Don't let old windows pile up.
    if (windows.size > 10_000)
      for (const [other, value] of windows) if (now - value.start >= period) windows.delete(other);
  }
  entry.count += 1;
  return { ok: entry.count <= limit, limit, retryAfter: Math.max(1, Math.ceil((entry.start + period - now) / 1000)) };
}

function binding(name: LimiterName): RateLimitBinding | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const candidate = env[name] as RateLimitBinding | undefined;
    return typeof candidate?.limit === "function" ? candidate : undefined;
  } catch {
    // Not running on Cloudflare (next dev, tests).
    return undefined;
  }
}

/** Counts one request for `key` and says whether it's within the limit. */
export async function rateLimit(name: LimiterName, key: string): Promise<RateLimitResult> {
  const limiter = binding(name);
  if (!limiter) return countLocally(name, key);
  try {
    const { success } = await limiter.limit({ key });
    return { ok: success, limit: LIMITS[name], retryAfter: PERIOD_SECONDS };
  } catch {
    // If the limiter itself fails, let the request through rather than break the feature.
    return { ok: true, limit: LIMITS[name], retryAfter: 0 };
  }
}

/** The caller's IP address, as Cloudflare reports it. */
export function clientAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
