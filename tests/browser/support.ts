/**
 * Browser tests run against a local Supabase stack (`supabase start`): Slate has no demo,
 * so every test gets its own throwaway account holding the example rental workspace, and
 * signs in through the real login form.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createSeedState, SEED_IDS } from "../fixtures/seed";

interface LocalSupabase {
  url: string;
  key: string;
  adminKey: string;
}
let cached: LocalSupabase | null = null;

/** The local stack's address and keys, from `supabase status`. Refuses anything not on this machine. */
export function localSupabase(): LocalSupabase {
  if (cached) return cached;
  const workdir = process.env.SUPABASE_TEST_WORKDIR;
  let status: Record<string, string>;
  try {
    status = JSON.parse(
      execFileSync("supabase", ["status", ...(workdir ? ["--workdir", workdir] : []), "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch {
    throw new Error("Browser tests need local Supabase. Run `supabase start` first.");
  }
  const url = new URL(status.API_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Browser tests only run against local Supabase.");
  const key = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const adminKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!key || !adminKey) throw new Error("`supabase status` did not include the local test keys.");
  cached = { url: url.origin, key, adminKey };
  return cached;
}

async function call<T>(path: string, init: { method?: string; token?: string; admin?: boolean; body?: unknown } = {}) {
  const { url, key, adminKey } = localSupabase();
  const auth = init.admin ? adminKey : init.token || key;
  const response = await fetch(`${url}${path}`, {
    method: init.method || "GET",
    headers: { apikey: init.admin ? adminKey : key, Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export interface TestAccount {
  userId: string;
  email: string;
  password: string;
  /** Example page ids, as they are in this account. */
  ids: typeof SEED_IDS;
}

/** A confirmed account whose workspace is the example rental workspace (with ids of its own). */
export async function createExampleAccount(): Promise<TestAccount> {
  const email = `slate-e2e-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Slate-e2e-${randomUUID()}-Aa9!`;
  const user = await call<{ id: string }>("/auth/v1/admin/users", {
    method: "POST",
    admin: true,
    body: { email, password, email_confirm: true, user_metadata: { display_name: "Test user" } },
  });
  const { access_token: token } = await call<{ access_token: string }>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  const { revision } = await call<{ revision: number }>("/rest/v1/rpc/load_workspace_state", { method: "POST", token, body: {} });
  // Every example id shares one prefix; a fresh one per account keeps accounts apart.
  const prefix = randomUUID().slice(0, 8);
  const remap = (text: string) => text.replaceAll("00000000-0000-4000-8000-", `${prefix}-0000-4000-8000-`);
  const state = JSON.parse(remap(JSON.stringify(createSeedState())));
  await call("/rest/v1/rpc/save_workspace_state", {
    method: "POST",
    token,
    body: { p_state: state, p_expected_revision: revision },
  });
  const ids = JSON.parse(remap(JSON.stringify(SEED_IDS))) as typeof SEED_IDS;
  return { userId: user.id, email, password, ids };
}

export async function deleteAccount(account: TestAccount | undefined) {
  if (account) await call(`/auth/v1/admin/users/${account.userId}`, { method: "DELETE", admin: true }).catch(() => {});
}

/** Removes an account a test registered through the sign-up form (if it exists). */
export async function deleteRegisteredAccount(email: string, password: string) {
  const session = await call<{ user: { id: string } }>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  }).catch(() => null);
  if (session) await call(`/auth/v1/admin/users/${session.user.id}`, { method: "DELETE", admin: true }).catch(() => {});
}

/** A fresh, unused address and password for a sign-up test. */
export function newCredentials() {
  return {
    email: `slate-e2e-signup-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`,
    password: `Slate-e2e-${randomUUID()}-Aa9!`,
  };
}

/** Signs in through the login form and lands in the app. */
export async function signIn(page: Page, account: TestAccount) {
  await page.goto("/auth/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

type MockAnswer = { status: number; body?: string };
/**
 * API steps go through Slate's server (/api/run-request), so the browser can't stub the
 * upstream API itself: this answers matching requests at /api/run-request instead.
 */
export async function mockApi(
  page: Page,
  urlPrefix: string,
  handler: (request: { method: string; url: string; headers: Record<string, string>; body?: string }) => MockAnswer,
) {
  await page.route("**/api/run-request", async (route) => {
    const sent = route.request().postDataJSON() as { method: string; url: string; headers: [string, string][]; body?: string };
    if (!sent?.url?.startsWith(urlPrefix)) return route.fallback();
    const headers = Object.fromEntries(sent.headers.map(([name, value]) => [name.toLowerCase(), value]));
    const { status, body = "" } = handler({ method: sent.method, url: sent.url, headers, body: sent.body });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status, ok: status >= 200 && status < 300, body }),
    });
  });
}

/** A real one-time email link token, as Supabase would put in an email (hashed_token). */
export async function emailLinkToken(type: "signup" | "recovery", email: string, password?: string) {
  const link = await call<{ hashed_token?: string; properties?: { hashed_token: string } }>("/auth/v1/admin/generate_link", {
    method: "POST",
    admin: true,
    body: { type, email, ...(password ? { password } : {}) },
  });
  const token = link.properties?.hashed_token || link.hashed_token;
  if (!token) throw new Error("Supabase did not return an email link token.");
  return token;
}

/** Contact-form messages saved for an address (read with the service key, as the operator would). */
export async function contactMessages(email: string) {
  return call<{ topic: string; email: string; message: string; user_id: string | null }[]>(
    `/rest/v1/contact_messages?email=eq.${encodeURIComponent(email.toLowerCase())}&select=topic,email,message,user_id`,
    { admin: true },
  );
}
export async function deleteContactMessages(email: string) {
  await call(`/rest/v1/contact_messages?email=eq.${encodeURIComponent(email.toLowerCase())}`, { method: "DELETE", admin: true }).catch(() => {});
}
