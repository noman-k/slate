import { test, expect } from "@playwright/test";
import { createExampleAccount, contactMessages, deleteAccount, deleteContactMessages, signIn } from "./support";

// These send real messages from one address, so they run in order (the form allows a few a minute).
test.describe.configure({ mode: "serial" });

test("a visitor finds the form, is guided through mistakes, and sends a message", async ({ page }) => {
  const email = `visitor-${Date.now()}@example.test`;
  try {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Contact" }).click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.getByRole("heading", { level: 1, name: "How can we help?" })).toBeVisible();
    // Sending an empty form explains each field and moves to the first one.
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Choose what your message is about.")).toBeVisible();
    await expect(page.getByText("Add your email, so you can get a reply.")).toBeVisible();
    await expect(page.getByText("Write a message.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Account or sign-in/ })).toBeFocused();
    // Picking a topic tailors the message prompt.
    await page.getByRole("radio", { name: /Privacy question/ }).check();
    await expect(page.getByLabel("Message", { exact: true })).toHaveAttribute("placeholder", "What would you like to know?");
    await page.getByLabel("Your email", { exact: true }).fill(email);
    await page.getByLabel("Message", { exact: true }).fill("Where is my data stored?");
    await page.getByRole("button", { name: "Send message" }).click();
    const sent = page.getByRole("status");
    await expect(sent).toContainText("Thanks, your message is in.");
    await expect(sent).toContainText(email);
    expect(await contactMessages(email)).toEqual([{ topic: "privacy", email, message: "Where is my data stored?", user_id: null }]);
    // Another message starts from a clean form.
    await page.getByRole("button", { name: "Send another message" }).click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  } finally {
    await deleteContactMessages(email);
  }
});

test("asking to delete an account: sign in first, then the request is tied to the account", async ({ page }) => {
  await page.goto("/contact?topic=delete");
  await expect(page.getByRole("radio", { name: /Delete my account or data/ })).toBeChecked();
  await expect(page.getByRole("link", { name: "Log in first" })).toBeVisible();
  const account = await createExampleAccount();
  try {
    await signIn(page, account);
    await page.goto("/contact?topic=delete");
    // Signed in: the email is filled in and there's no need to log in.
    await expect(page.getByLabel("Your email", { exact: true })).toHaveValue(account.email);
    await expect(page.getByRole("link", { name: "Log in first" })).toHaveCount(0);
    await page.getByLabel("Message", { exact: true }).fill("Please delete my account and everything in it.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("status")).toContainText("Thanks, your message is in.");
    const [saved] = await contactMessages(account.email);
    expect(saved).toMatchObject({ topic: "delete", user_id: account.userId });
  } finally {
    await deleteContactMessages(account.email);
    await deleteAccount(account);
  }
});

test("bots that fill the hidden field are quietly ignored", async ({ request }) => {
  const email = `bot-${Date.now()}@example.test`;
  const response = await request.post("/api/contact", {
    data: { topic: "other", email, message: "Buy cheap things now!!!", website: "https://spam.example" },
  });
  expect(response.status()).toBe(200);
  expect(await contactMessages(email)).toEqual([]);
});

test("the API checks messages on the server too", async ({ request }) => {
  const response = await request.post("/api/contact", { data: { topic: "nonsense", email: "nope", message: "hi" } });
  expect(response.status()).toBe(400);
  expect(Object.keys((await response.json()).errors).sort()).toEqual(["email", "message", "topic"]);
});
