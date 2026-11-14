import { describe, expect, it } from "vitest";
import { looksLikeAgentKey } from "../src/lib/agent-keys";
import {
  authorizationServerMetadata,
  isAllowedRedirectUri,
  newAccessToken,
  newAuthorizationCode,
  newRefreshToken,
  pkceChallenge,
  protectedResourceMetadata,
  redirectWith,
  requestOrigin,
  returnPlace,
} from "../src/lib/oauth";

describe("OAuth for connecting apps", () => {
  it("only lets apps register safe return addresses", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "http://127.0.0.1:33418/callback",
      "http://localhost:6274/oauth/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback",
    ])
      expect(isAllowedRedirectUri(ok), ok).toBe(true);
    for (const bad of [
      "http://example.com/callback",
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "https://app.example/cb#fragment",
      "not a url",
      42,
    ])
      expect(isAllowedRedirectUri(bad), String(bad)).toBe(false);
  });

  it("sends people back with the code, keeping the app's own query", () => {
    const url = new URL(redirectWith("https://app.example/cb?keep=1", { code: "c", state: "s", unused: undefined }));
    expect(Object.fromEntries(url.searchParams)).toEqual({ keep: "1", code: "c", state: "s" });
  });

  it("names where people go back to in plain words", () => {
    expect(returnPlace("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(returnPlace("http://127.0.0.1:1234/cb")).toBe("an app on this computer");
    expect(returnPlace("cursor://anysphere.cursor-mcp/oauth/callback")).toBe("the cursor app");
  });

  it("makes tokens the MCP endpoint accepts, each one different", () => {
    const tokens = [newAccessToken(), newRefreshToken(), newAuthorizationCode()];
    expect(tokens[0]).toMatch(/^slate_at_/);
    expect(tokens[1]).toMatch(/^slate_rt_/);
    for (const token of tokens) expect(looksLikeAgentKey(token)).toBe(true);
    expect(new Set([...tokens, newAccessToken()]).size).toBe(4);
  });

  it("computes PKCE S256 challenges as RFC 7636 does", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUpztY2wOm3qEWQgBpFW1gFWFOEjXk")).toBe(
      "lM256Y9dUZHNg6TRyZZFhtYdGB-w6GMbEvlKDOsu4AA",
    );
  });

  it("describes itself from the address it's reached on", () => {
    const origin = requestOrigin(
      new Request("http://0.0.0.0:3000/api/mcp", { headers: { "x-forwarded-host": "slate.noman.io", "x-forwarded-proto": "https" } }),
    );
    expect(origin).toBe("https://slate.noman.io");
    expect(protectedResourceMetadata(origin)).toMatchObject({
      resource: "https://slate.noman.io/api/mcp",
      authorization_servers: ["https://slate.noman.io"],
    });
    expect(authorizationServerMetadata(origin)).toMatchObject({
      issuer: "https://slate.noman.io",
      authorization_endpoint: "https://slate.noman.io/oauth/authorize",
      token_endpoint: "https://slate.noman.io/api/oauth/token",
      registration_endpoint: "https://slate.noman.io/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});
