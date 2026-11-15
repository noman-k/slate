import { test, expect } from "@playwright/test";
import { deleteRegisteredAccount, emailLinkToken, newCredentials } from "./support";

// A visitor with no account: from the front page to their own workspace. The later
// tests reuse the account the first one creates, so they run in order.
test.describe.configure({ mode: "serial" });
const visitor = newCredentials();
test.afterAll(async () => {
  await deleteRegisteredAccount(visitor.email, visitor.password);
});

test("signing up takes an email and a password and opens a Getting started page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get started for free" }).first().click();
  await expect(page).toHaveURL(/\/auth\/register$/);
  // Only what's needed: no name field, and the password rule is shown up front.
  await expect(page.getByLabel("Your name")).toHaveCount(0);
  await expect(page.getByText("At least 8 characters.")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.getByLabel("Email address").fill(visitor.email);
  await page.locator('input[autocomplete="new-password"]').fill(visitor.password);
  await page.getByRole("button", { name: "Create account" }).click();
  // Straight into the workspace (local Supabase doesn't ask to confirm the email).
  await expect(page).toHaveURL(/\/(app|p\/[0-9a-f-]+)$/);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  await expect(page.getByLabel("Page content", { exact: true })).toContainText("Try these first");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await expect(sidebar).toContainText("Getting started");
});

test("signing up again with the same email points to logging in", async ({ page }) => {
  // Runs after the first test has created the account (tests in a file run in order).
  await page.goto("/auth/register");
  await page.getByLabel("Email address").fill(visitor.email);
  await page.locator('input[autocomplete="new-password"]').fill(visitor.password);
  await page.getByRole("button", { name: "Create account" }).click();
  // The form's own alert (Next.js also keeps an empty route announcer with role="alert").
  const alert = page.locator(".auth-error");
  await expect(alert).toContainText("There’s already an account with this email.");
  await alert.getByRole("link", { name: "Log in instead" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test("a wrong password says so plainly", async ({ page }) => {
  await page.goto("/auth/login");
  await page.getByLabel("Email address").fill(visitor.email);
  await page.locator('input[autocomplete="current-password"]').fill("not-the-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".auth-error")).toContainText("That email and password don’t match.");
});

test("when email confirmation is on, sign-up says where the link went and can resend it", async ({ page }) => {
  // Local Supabase signs people in straight away; a hosted project usually asks them to
  // confirm first. Answer as that project would: an account, but no session yet.
  const { email, password } = newCredentials();
  let resent = "";
  await page.route("**/auth/v1/signup*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-4000-8000-0000000000aa",
        aud: "authenticated",
        role: "",
        email,
        confirmation_sent_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    }),
  );
  await page.route("**/auth/v1/resend*", async (route) => {
    resent = (route.request().postDataJSON() as { email: string }).email;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/auth/register");
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Almost there." })).toBeVisible();
  const sent = page.locator(".auth-sent");
  await expect(sent).toContainText("Check your inbox");
  await expect(sent).toContainText(email);
  await sent.getByRole("button", { name: "Resend the link" }).click();
  await expect(sent.getByRole("button", { name: "New link sent" })).toBeDisabled();
  expect(resent).toBe(email);
  // A typo in the address: go back to the form.
  await sent.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("an email confirmation link survives being opened by a mail scanner, and works in any browser", async ({
  page,
  request,
}) => {
  const { email, password } = newCredentials();
  try {
    const token = await emailLinkToken("signup", email, password);
    const link = `/auth/confirm?token_hash=${token}&type=email`;
    // Mail scanners open every link: a plain visit must not use the token up.
    expect((await request.get(link)).status()).toBe(200);
    expect((await request.get(link)).status()).toBe(200);
    // This browser never signed up (no sign-up cookies): the link still works here.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "One click to go." })).toBeVisible();
    await page.getByRole("button", { name: "Confirm and open Slate" }).click();
    await expect(page).toHaveURL(/\/(app|p\/[0-9a-f-]+)$/);
    await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
    // A link that has been used already says so, and offers a new one.
    await page.context().clearCookies();
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm and open Slate" }).click();
    await expect(page).toHaveURL(/\/auth\/login\?error=confirmation_failed$/);
    await expect(page.locator(".auth-error")).toContainText("expired or was already used");
    await expect(page.locator(".auth-error").getByRole("button", { name: "Send a new link" })).toBeVisible();
  } finally {
    await deleteRegisteredAccount(email, password);
  }
});

test("a password reset link opens the new-password form", async ({ page }) => {
  const token = await emailLinkToken("recovery", visitor.email);
  await page.goto(`/auth/confirm?token_hash=${token}&type=recovery`);
  await expect(page.getByRole("heading", { name: "Reset your password." })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/auth\/reset$/);
  await expect(page.getByRole("heading", { name: "Set a new password." })).toBeVisible();
});

test("a broken link explains itself", async ({ page }) => {
  await page.goto("/auth/confirm?type=email");
  await expect(page.getByRole("heading", { name: "This link isn’t complete." })).toBeVisible();
});
