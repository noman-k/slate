import { test, expect } from "@playwright/test";
import { AGENT_TOOLS } from "../../src/lib/agent-tools";
import { WRITE_TOOLS } from "../../src/lib/agent-writes";

// The MCP guide is public: no account needed to read it.
test("the MCP guide is public and documents every tool", async ({ page, baseURL }) => {
  await page.goto("/docs/mcp");
  await expect(page).toHaveURL(/\/docs\/mcp$/);
  await expect(page.getByRole("heading", { level: 1, name: "Connect AI agents to Slate" })).toBeVisible();
  // The endpoint is this server's own address.
  await expect(page.locator(".docs-endpoint code")).toHaveText(`${baseURL}/api/mcp`);
  // The tools reference comes from the same list the server answers tools/list with.
  for (const tool of [...AGENT_TOOLS, ...WRITE_TOOLS]) await expect(page.locator(`#tool-${tool.name}`)).toContainText(tool.title);
  await expect(page.locator("#tool-create_page")).toContainText("Creates");
  await expect(page.locator("#tool-read_page")).toContainText("Read-only");
});

test("setup tabs switch by click and arrow keys, and remember the choice", async ({ page }) => {
  await page.goto("/docs/mcp#setup");
  const tabs = page.getByRole("tablist", { name: "AI client" });
  // Signing in comes first: Claude takes just the address.
  await expect(tabs.getByRole("tab", { name: "Claude", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Add custom connector");
  await expect(page.getByRole("tabpanel")).not.toContainText("slate_YOUR_KEY");
  await tabs.getByRole("tab", { name: "Cursor" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("mcp.json");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "VS Code" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText(".vscode/mcp.json");
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "VS Code" })).toHaveAttribute("aria-selected", "true");
});

test("the landing page links to the guide", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See the setup guide" }).click();
  await expect(page).toHaveURL(/\/docs\/mcp$/);
});

test("the privacy page is public and gives a way to reach the operator", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send a message" }).first()).toHaveAttribute("href", "/contact?topic=privacy");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
  // No email address on the page: everything goes through the contact form.
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
});
