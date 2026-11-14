import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const cloudflare = vi.hoisted(() => ({ env: null as Record<string, unknown> | null }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!cloudflare.env) throw new Error("not on Cloudflare");
    return { env: cloudflare.env };
  },
}));
import { LIMITS, PERIOD_SECONDS, clientAddress, countLocally, rateLimit } from "../src/lib/rate-limit";

beforeEach(() => {
  cloudflare.env = null;
});

describe("local rate limiting (next dev)", () => {
  it("allows up to the limit in a minute, then refuses until the minute is over", () => {
    const start = 1_000_000;
    for (let i = 0; i < 3; i++) expect(countLocally("RUN_REQUEST_LIMITER", "user-a", 3, start + i).ok).toBe(true);
    const refused = countLocally("RUN_REQUEST_LIMITER", "user-a", 3, start + 10_000);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBe(50);
    expect(countLocally("RUN_REQUEST_LIMITER", "user-a", 3, start + PERIOD_SECONDS * 1000).ok).toBe(true);
  });
  it("counts each key and each limiter separately", () => {
    const now = 2_000_000;
    expect(countLocally("MCP_KEY_LIMITER", "key-1", 1, now).ok).toBe(true);
    expect(countLocally("MCP_KEY_LIMITER", "key-1", 1, now).ok).toBe(false);
    expect(countLocally("MCP_KEY_LIMITER", "key-2", 1, now).ok).toBe(true);
    expect(countLocally("MCP_IP_LIMITER", "key-1", 1, now).ok).toBe(true);
  });
  it("is used when there's no Cloudflare binding", async () => {
    expect((await rateLimit("MCP_IP_LIMITER", `fresh-${Math.random()}`)).ok).toBe(true);
  });
});

describe("Cloudflare rate limiting (production)", () => {
  it("asks the binding, keyed by the caller", async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: key !== "over" }));
    cloudflare.env = { RUN_REQUEST_LIMITER: { limit } };
    expect(await rateLimit("RUN_REQUEST_LIMITER", "user-b")).toEqual({ ok: true, limit: 30, retryAfter: PERIOD_SECONDS });
    expect(await rateLimit("RUN_REQUEST_LIMITER", "over")).toEqual({ ok: false, limit: 30, retryAfter: PERIOD_SECONDS });
    expect(limit).toHaveBeenCalledWith({ key: "user-b" });
  });
  it("lets requests through if the limiter itself fails", async () => {
    cloudflare.env = { MCP_KEY_LIMITER: { limit: async () => { throw new Error("unavailable"); } } };
    expect((await rateLimit("MCP_KEY_LIMITER", "key")).ok).toBe(true);
  });
  it("matches the limits declared in wrangler.jsonc", () => {
    const { experimental_readRawConfig } = createRequire(import.meta.url)("wrangler") as {
      experimental_readRawConfig: (a: { config: string }, b: object) => { rawConfig: { ratelimits?: { name: string; simple: { limit: number; period: number } }[] } };
    };
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" }, { useRedirectIfAvailable: false });
    const declared = Object.fromEntries((rawConfig.ratelimits || []).map((r) => [r.name, r.simple]));
    for (const [name, limit] of Object.entries(LIMITS)) expect(declared[name]).toEqual({ limit, period: PERIOD_SECONDS });
  });
});

describe("caller address", () => {
  it("prefers Cloudflare's header", () => {
    const request = new Request("https://x", { headers: { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" } });
    expect(clientAddress(request)).toBe("203.0.113.7");
    expect(clientAddress(new Request("https://x", { headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" } }))).toBe("198.51.100.1");
  });
});
