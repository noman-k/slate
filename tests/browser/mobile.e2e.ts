import { test, expect, type Page } from "@playwright/test";
import { createExampleAccount, deleteAccount, signIn, type TestAccount } from "./support";

// A phone: small screen, touch, no hover.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/** Problems a phone would show: fields that make Safari zoom in, and anything wider than the screen. */
async function phoneProblems(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const zoomy: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select, [contenteditable=true]"))) {
      if (el.matches("[type=checkbox], [type=radio], [type=hidden], [aria-hidden=true] *, [tabindex='-1']")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || el.getBoundingClientRect().width === 0) continue;
      if (parseFloat(style.fontSize) < 16) zoomy.push(`${el.tagName.toLowerCase()}.${el.className} ${style.fontSize}`);
    }
    return { zoomy, overflow: document.documentElement.scrollWidth - width };
  });
}

let account: TestAccount | undefined;
test.beforeEach(async ({ page }) => {
  account = await createExampleAccount();
  await signIn(page, account);
});
test.afterEach(async () => {
  await deleteAccount(account);
  account = undefined;
});

test("the phone has no hover, and sidebar pages open on the first tap", async ({ page }) => {
  expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  const sidebar = page.locator("aside.sidebar");
  await sidebar.locator(".tree-page", { hasText: "Workspace notes" }).first().tap();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Workspace notes");
  // The current page's row keeps its actions, since there's no hover to reveal them.
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect(sidebar.locator(".tree-row.selected .tree-actions")).toBeVisible();
});

test("subpages in the sidebar line up by level, with room for a finger", async ({ page }) => {
  await page.goto(`/p/${account!.ids.ledger}`);
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  const sidebar = page.locator("aside.sidebar");
  // Opening a page shows its parents expanded: hub > Tenant Rent Log > Rent Ledger.
  await expect(sidebar.locator(".tree-row", { hasText: "Rent Ledger" })).toBeVisible();
  const iconLeft = (title: string) =>
    sidebar.locator(".tree-row", { hasText: title }).first().locator(".tree-page .page-icon").evaluate((el) => Math.round(el.getBoundingClientRect().left));
  const [hub, log, ledger, tenants, notes] = await Promise.all(
    ["Rental Property Finance Hub", "Tenant Rent Log", "Rent Ledger", "Tenants", "Workspace notes"].map(iconLeft),
  );
  // Same level, same column, whether or not a page has subpages…
  expect(log).toBe(tenants);
  expect(hub).toBe(notes);
  // …and each level sits further in than its parent.
  expect(log).toBeGreaterThan(hub);
  expect(ledger).toBeGreaterThan(log);
  // Rows and the chevron are big enough to tap.
  const row = await sidebar.locator(".tree-row").first().boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(38);
  const chevron = await sidebar.getByRole("button", { name: "Collapse Rental Property Finance Hub" }).boundingBox();
  expect(chevron!.width).toBeGreaterThanOrEqual(24);
  // The chevron still works: collapsing hides the subpages.
  await sidebar.getByRole("button", { name: "Collapse Rental Property Finance Hub" }).tap();
  await expect(sidebar.locator(".tree-row", { hasText: "Tenant Rent Log" })).toHaveCount(0);
});

test("pages, databases, playbooks and search fit the screen, with no fields that zoom in", async ({ page }) => {
  for (const id of [account!.ids.hub, account!.ids.ledger]) {
    await page.goto(`/p/${id}`);
    await expect(page.getByLabel("Page title", { exact: true })).toBeVisible();
    expect(await phoneProblems(page)).toEqual({ zoomy: [], overflow: 0 });
  }
  // A playbook, built from a template.
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await page.getByRole("button", { name: "New page", exact: true }).first().tap();
  await page.getByLabel("Start this page").getByRole("button", { name: "Playbook", exact: true }).tap();
  const gallery = page.locator(".procedure-gallery");
  if (!(await gallery.getByRole("option", { name: /Refund request/ }).count()))
    await gallery.getByRole("button", { name: /^More templates/ }).tap();
  await gallery.getByRole("option", { name: /Refund request/ }).tap();
  await page.keyboard.press("Enter");
  const step = page.locator(".pb-step").first();
  await expect(step).toBeVisible();
  expect(await phoneProblems(page)).toEqual({ zoomy: [], overflow: 0 });
  // A step's text has its own full-width line, and its "…" is there without hovering.
  const [text, badge] = await Promise.all([step.locator(".pb-step-text").boundingBox(), step.locator(".proc-step-badge").boundingBox()]);
  expect(text!.y).toBeGreaterThan(badge!.y + badge!.height - 1);
  await expect(step.getByRole("button", { name: /Step 1\.1 options|Step .* options/ })).toBeVisible();
  // The outline doesn't scroll inside the page (no second scrollbar).
  const outline = page.locator(".pb-outline");
  if (await outline.count()) expect(await outline.evaluate((el) => getComputedStyle(el).overflowY)).not.toBe("auto");
  // Search.
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await page.getByRole("button", { name: /^Search/ }).first().tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await phoneProblems(page)).zoomy).toEqual([]);
});

test("iPhone Safari gets a no-zoom safety net; other phones keep pinch-zoom untouched", async ({ browser }) => {
  for (const ios of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    if (ios) await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "iPhone" }));
    await page.goto("/auth/login");
    await page.waitForLoadState("networkidle");
    const contents = await page.locator('meta[name="viewport"]').evaluateAll((metas) => metas.map((m) => (m as HTMLMetaElement).content));
    expect(contents.length).toBeGreaterThan(0);
    for (const content of contents) expect(content.includes("maximum-scale=1")).toBe(ios);
    await context.close();
  }
});

/** A new page with a to-do, a link to another site and a link to a Slate page, then "put the phone down". */
async function pageWithTodoAndLinks(page: Page, baseURL: string, hub: string) {
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await page.getByRole("button", { name: "New page", exact: true }).first().tap();
  const start = page.getByLabel("Start this page");
  if (await start.count()) await start.getByRole("button", { name: /^(Empty|Blank|Page)/ }).first().tap().catch(() => {});
  await page.getByLabel("Page title", { exact: true }).fill("Errands");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  const editor = page.getByLabel("Page content", { exact: true });
  await page.keyboard.type("[] Buy milk");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Shop: https://shop.example.test/milk then hub: ${baseURL}/p/${hub} `);
  await expect(editor.locator('ul[data-type="taskList"] > li')).toHaveCount(1);
  await expect(editor.locator('a[href^="https://shop.example.test"]')).toHaveCount(1);
  // Done typing: the keyboard goes away.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return editor;
}
const editorHasFocus = (page: Page) => page.evaluate(() => !!document.activeElement?.closest(".ProseMirror"));

test("tapping a to-do or a link uses it, without raising the keyboard", async ({ page, baseURL, context }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  const editor = await pageWithTodoAndLinks(page, baseURL!, account!.ids.hub);
  // A to-do ticks off, and the page doesn't start editing.
  const box = editor.locator('ul[data-type="taskList"] > li input[type="checkbox"]');
  await box.tap();
  await expect(box).toBeChecked();
  expect(await editorHasFocus(page)).toBe(false);
  await box.tap();
  await expect(box).not.toBeChecked();
  await box.tap();
  // A link to another site opens in a new tab.
  await context.route("https://shop.example.test/**", (route) => route.fulfill({ body: "shop" }));
  const [tab] = await Promise.all([context.waitForEvent("page"), editor.locator('a[href^="https://shop.example.test"]').tap()]);
  await expect(tab).toHaveURL("https://shop.example.test/milk");
  await tab.close();
  expect(await editorHasFocus(page)).toBe(false);
  // A link to a Slate page opens it right here.
  const errands = page.url();
  await editor.locator(`a[href$="/p/${account!.ids.hub}"]`).tap();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rental Property Finance Hub");
  // The ticked to-do was saved.
  await page.goto(errands);
  await expect(page.locator('ul[data-type="taskList"] > li input[type="checkbox"]')).toBeChecked();
});

test("while editing, tapping text or a link just moves the cursor", async ({ page, baseURL }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  const editor = await pageWithTodoAndLinks(page, baseURL!, account!.ids.hub);
  await editor.locator("p").first().tap();
  expect(await editorHasFocus(page)).toBe(true);
  // Already editing: a tap on a link places the cursor in it, so its text can be changed.
  const before = page.url();
  await editor.locator('a[href^="https://shop.example.test"]').tap();
  expect(page.url()).toBe(before);
  expect(await editorHasFocus(page)).toBe(true);
});

test("on a touch screen, help shows touch tips instead of keyboard shortcuts", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  // The floating help button (the sidebar's own copy is off-screen while it's closed).
  await page.locator("button.help-button").tap();
  const help = page.locator(".shortcuts");
  await expect(help).toContainText("A few helpful tips");
  await expect(help).toContainText("Tap Search in the sidebar");
  await expect(help.locator("kbd")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // No key hint on the sidebar's Search either.
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect(page.locator("aside.sidebar .sidebar-search")).toBeVisible();
  await expect(page.locator("aside.sidebar .sidebar-search kbd")).toHaveCount(0);
});

test("opening a database row on a phone doesn't raise the keyboard", async ({ page }) => {
  await page.goto(`/p/${account!.ids.ledger}`);
  await page.getByRole("button", { name: "Open 2026-04 — Basement", exact: true }).tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Record title")).toHaveValue(/2026-04/);
  // The panel has focus, so no text field is active (and no keyboard comes up).
  await expect(dialog).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.matches("input, textarea, [contenteditable=true]"))).toBe(false);
});
