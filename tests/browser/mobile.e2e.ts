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
