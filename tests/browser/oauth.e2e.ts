import { createHash, randomBytes } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { createExampleAccount, deleteAccount, signIn, type TestAccount } from "./support";

/**
 * Connecting an app by signing in (OAuth), the way Claude, ChatGPT or Codex do it: the MCP
 * endpoint's 401 leads to the metadata, the app registers, the person signs in and allows
 * it, and the app swaps the code for tokens.
 */
const REDIRECT = "https://app.example.test/callback";

let account: TestAccount | undefined;
test.beforeEach(async ({ page }) => {
  account = await createExampleAccount();
  await signIn(page, account);
});
test.afterEach(async () => {
  await deleteAccount(account);
  account = undefined;
});

const mcp = (api: APIRequestContext, token: string | null, method: string) =>
  api.post("/api/mcp", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    data: { jsonrpc: "2.0", id: 1, method, params: {} },
  });

/** Discovers the endpoints from a bare 401, registers, and builds the sign-in link. */
async function startConnecting(api: APIRequestContext, baseURL: string) {
  const first = await mcp(api, null, "tools/list");
  expect(first.status()).toBe(401);
  const metadataUrl = first.headers()["www-authenticate"].match(/resource_metadata="([^"]+)"/)?.[1];
  expect(metadataUrl).toBe(`${baseURL}/.well-known/oauth-protected-resource`);
  const resource = await (await api.get(metadataUrl!)).json();
  expect(resource.resource).toBe(`${baseURL}/api/mcp`);
  const server = await (await api.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
  const registered = await api.post(server.registration_endpoint, { data: { client_name: "E2E app", redirect_uris: [REDIRECT] } });
  expect(registered.status()).toBe(201);
  const { client_id } = await registered.json();
  const verifier = randomBytes(32).toString("base64url");
  const link = `${server.authorization_endpoint}?${new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: REDIRECT,
    state: "xyz",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "read write",
    resource: resource.resource,
  })}`;
  return { server, client_id, verifier, link };
}

test("an app connects by signing in, to the workspace chosen, with no key to copy", async ({ page, browser, playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const { server, client_id, verifier, link } = await startConnecting(api, baseURL!);

  // Someone who isn't signed in logs in first, and comes straight back to the question.
  const context = await browser.newContext();
  await context.route("https://app.example.test/**", (route) => route.fulfill({ body: "Back in the app" }));
  const visitor = await context.newPage();
  await visitor.goto(link);
  await expect(visitor).toHaveURL(/\/auth\/login\?next=/);
  await visitor.getByLabel("Email address").fill(account!.email);
  await visitor.locator('input[autocomplete="current-password"]').fill(account!.password);
  await visitor.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(visitor.getByRole("heading", { name: "Connect E2E app?" })).toBeVisible();
  await expect(visitor.locator(".auth-subtitle")).toContainText("go back to app.example.test");
  // Read only unless chosen otherwise; it can only reach the workspace named.
  await expect(visitor.getByRole("radio", { name: /Read only/ })).toBeChecked();
  await expect(visitor.locator(".oauth-note")).toContainText("never your other workspaces");
  await visitor.getByRole("radio", { name: /Read and create/ }).check();
  await visitor.getByRole("button", { name: "Allow access" }).click();
  await expect(visitor).toHaveURL(/^https:\/\/app\.example\.test\/callback\?/);
  const back = new URL(visitor.url());
  expect(back.searchParams.get("state")).toBe("xyz");
  const code = back.searchParams.get("code")!;
  await context.close();

  // The app swaps the code for tokens; the code works once.
  const exchange = () =>
    api.post(server.token_endpoint, { form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id, code_verifier: verifier } });
  const issued = await exchange();
  expect(issued.status()).toBe(200);
  const tokens = await issued.json();
  expect(tokens).toMatchObject({ token_type: "Bearer", scope: "write", expires_in: 3600 });
  expect((await (await exchange()).json()).error).toBe("invalid_grant");

  // The token opens the workspace, with the creating tools allowed.
  const tools = (await (await mcp(api, tokens.access_token, "tools/list")).json()).result.tools.map((t: { name: string }) => t.name);
  expect(tools).toEqual(expect.arrayContaining(["search_workspace", "create_page"]));

  // Refreshing replaces both tokens.
  const refreshed = await (
    await api.post(server.token_endpoint, { form: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id } })
  ).json();
  expect((await mcp(api, refreshed.access_token, "ping")).status()).toBe(200);
  expect((await mcp(api, tokens.access_token, "ping")).status()).toBe(401);

  // It's listed in Settings › AI agents, and disconnecting it stops it at once.
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const row = page.getByRole("region", { name: "AI agents" }).locator(".agent-keys li", { hasText: "E2E app" });
  await expect(row).toContainText("Connected by signing in");
  await expect(row).toContainText("Read and create");
  await row.getByRole("button", { name: "Disconnect" }).click();
  await row.getByRole("button", { name: "Disconnect" }).click();
  await expect(row).toHaveCount(0);
  const refused = await mcp(api, refreshed.access_token, "ping");
  expect(refused.status()).toBe(401);
  expect(refused.headers()["www-authenticate"]).toContain('error="invalid_token"');
  await api.dispose();
});

test("cancelling sends the app back empty-handed; an unknown app is never redirected", async ({ page, playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const { link } = await startConnecting(api, baseURL!);
  await page.context().route("https://app.example.test/**", (route) => route.fulfill({ body: "Back in the app" }));
  const consent = await page.goto(link);
  // Another site can't frame the page to trick a click on Allow.
  expect(consent!.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/^https:\/\/app\.example\.test\/callback\?/);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ error: "access_denied", state: "xyz" });

  // A made-up app, or a return address the app didn't register, gets an explanation instead.
  await page.goto(`/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: "nope", redirect_uri: "https://evil.example.test/" })}`);
  await expect(page.getByRole("heading", { name: /This link can.t connect an app/ })).toBeVisible();
  expect(new URL(page.url()).hostname).not.toContain("evil");
  // Apps can't register return addresses that would run code or reach other sites in the clear.
  const bad = await api.post("/api/oauth/register", { data: { client_name: "Bad", redirect_uris: ["javascript:alert(1)"] } });
  expect(bad.status()).toBe(400);
  await api.dispose();
});
