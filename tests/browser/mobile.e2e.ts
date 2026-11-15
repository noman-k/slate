import { test, expect, type Page } from "@playwright/test";
import { createExampleAccount, deleteAccount, signIn, type TestAccount } from "./support";

// A phone: small screen, touch, no hover.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/** Problems a phone would show: fields that make Safari zoom in, and anything wider than the screen. */
async function phoneProblems(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const zoomy: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("input, textarea, select, [contenteditable=true]"),
    )) {
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
    sidebar
      .locator(".tree-row", { hasText: title })
      .first()
      .locator(".tree-page .page-icon")
      .evaluate((el) => Math.round(el.getBoundingClientRect().left));
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
  const [text, badge] = await Promise.all([
    step.locator(".pb-step-text").boundingBox(),
    step.locator(".proc-step-badge").boundingBox(),
  ]);
  expect(text!.y).toBeGreaterThan(badge!.y + badge!.height - 1);
  await expect(step.getByRole("button", { name: /Step 1\.1 options|Step .* options/ })).toBeVisible();
  // The outline doesn't scroll inside the page (no second scrollbar).
  const outline = page.locator(".pb-outline");
  if (await outline.count()) expect(await outline.evaluate((el) => getComputedStyle(el).overflowY)).not.toBe("auto");
  // Search.
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await page
    .getByRole("button", { name: /^Search/ })
    .first()
    .tap();
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
    const contents = await page
      .locator('meta[name="viewport"]')
      .evaluateAll((metas) => metas.map((m) => (m as HTMLMetaElement).content));
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
  if (await start.count())
    await start
      .getByRole("button", { name: /^(Empty|Blank|Page)/ })
      .first()
      .tap()
      .catch(() => {});
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
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    editor.locator('a[href^="https://shop.example.test"]').tap(),
  ]);
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

test("on a phone a database row opens as a full page, without raising the keyboard, and Back returns", async ({
  page,
}) => {
  await page.goto(`/p/${account!.ids.ledger}`);
  const ledger = page.url();
  await page.getByRole("button", { name: "Open 2026-04 — Basement", exact: true }).tap();
  // A full page (a side panel would fill the screen anyway): no dialog over the table.
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("2026-04 — Basement");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.matches("input, textarea, [contenteditable=true]"))).toBe(
    false,
  );
  await page.goBack();
  await expect(page).toHaveURL(ledger);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rent Ledger");
  // A linked record opens the same way.
  await page.locator("tbody tr").first().getByRole("button", { name: "Alex Morgan" }).tap();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Alex Morgan");
  // The side panel / full page choice is a desktop setting: not offered on a phone.
  await page.goto(ledger);
  await page.getByRole("button", { name: "View settings" }).first().tap();
  await expect(page.locator(".db-menu")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Open records in" })).toHaveCount(0);
});

test("a page block opens on the first tap, and a tap reveals nothing before it's used", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  // Safari treats a tap that makes something appear before its click as a hover, and
  // needs a second tap. So record anything added to the page between touch and click.
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { tapLog: string[] }).tapLog = log;
    let watching = false;
    new MutationObserver((changes) => {
      if (!watching) return;
      for (const change of changes)
        for (const node of Array.from(change.addedNodes))
          if (node instanceof HTMLElement && node.matches(".block-controls")) log.push("handles");
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("touchstart", () => (watching = true), true);
    window.addEventListener(
      "click",
      () => {
        watching = false;
        log.push("click");
      },
      true,
    );
  });
  await page.locator(".editor-page-reference", { hasText: "Tenant Rent Log" }).tap();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Tenant Rent Log");
  expect(await page.evaluate(() => (window as unknown as { tapLog: string[] }).tapLog)).not.toContain("handles");
  // Tapping text to edit it still brings up that block's handles, after the tap.
  await page.goBack();
  await page.getByLabel("Page content", { exact: true }).locator("p").first().tap();
  await expect(page.locator(".block-controls")).toBeVisible();
  // While editing too, a page block opens on the first tap.
  await page.locator(".editor-page-reference", { hasText: "Tenant Rent Log" }).tap();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Tenant Rent Log");
});

test("swiping the sidebar scrolls it; only a long press picks a page up", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect.poll(async () => (await page.locator("aside.sidebar").boundingBox())?.x).toBe(0);
  const sidebar = page.locator("aside.sidebar");
  const order = () => sidebar.locator(".tree-page .tree-title").allTextContents();
  await expect(sidebar.locator(".tree-page").nth(1)).toBeVisible();
  const before = await order();
  const row = sidebar.locator(".tree-page").nth(1);
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // A quick swipe down the list: no page moves.
  await touch("touchStart", x, y);
  for (let step = 1; step <= 8; step++) await touch("touchMove", x, y + step * 12);
  await touch("touchEnd", x, y + 96);
  await expect(sidebar.locator(".tree-row.is-dragging")).toHaveCount(0);
  expect(await order()).toEqual(before);
  // Press and hold, then move: now the page is being dragged.
  await touch("touchStart", x, y);
  await page.waitForTimeout(500);
  await touch("touchMove", x, y + 12);
  await touch("touchMove", x, y + 24);
  await expect(sidebar.locator(".tree-row.is-dragging")).toHaveCount(1);
  await touch("touchEnd", x, y);
});

test("menus on a phone: finger-sized rows, on screen, and no keyboard until you ask for it", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  // A sidebar page's menu fits on the screen (there's no room beside it on a phone).
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  // Once the drawer has slid in.
  await expect.poll(async () => (await page.locator("aside.sidebar").boundingBox())?.x).toBe(0);
  await page.getByRole("button", { name: "Actions for Rental Property Finance Hub" }).tap();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Measured once its opening animation has finished.
  await page.waitForTimeout(300);
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  for (const item of await menu.getByRole("menuitem").all())
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  // A database's menus don't put the cursor in a field (that would raise the keyboard over them).
  await page.goto(`/p/${account!.ids.ledger}`);
  await page.getByRole("button", { name: "Add property" }).first().tap();
  await expect(page.locator(".db-menu")).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.matches("input, textarea"))).toBe(false);
});

test("the sidebar slides in and out as a drawer, with a backdrop that fades both ways", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  const sidebar = page.locator("aside.sidebar");
  const scrim = page.locator(".sidebar-scrim");
  // Closed from the start: moved off screen (not squashed to no width), hidden, and the
  // backdrop is see-through and untappable.
  await expect(page.locator(".workspace-app.is-settled")).toBeAttached();
  await expect(sidebar).toBeHidden();
  const closed = await sidebar.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    transform: getComputedStyle(el).transform,
  }));
  expect(closed.width).toBeGreaterThan(200);
  expect(closed.transform).toMatch(/matrix\(1, 0, 0, 1, -2\d\d/);
  await expect(sidebar).toBeHidden();
  await expect(scrim).toBeHidden();
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect(sidebar).toBeVisible();
  await expect.poll(() => scrim.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  // Tapping the backdrop closes it; the backdrop fades out rather than vanishing.
  await scrim.tap({ position: { x: 360, y: 400 } });
  await expect.poll(() => scrim.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  await expect(sidebar).toBeHidden();
});

test("playbooks on a phone: a roomy list, fields that fit, and run buttons within a thumb's reach", async ({
  page,
}) => {
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect.poll(async () => (await page.locator("aside.sidebar").boundingBox())?.x).toBe(0);
  await page.getByRole("button", { name: "New page", exact: true }).first().tap();
  await page.getByLabel("Start this page").getByRole("button", { name: "Playbook", exact: true }).tap();
  const gallery = page.locator(".procedure-gallery");
  if (!(await gallery.getByRole("option", { name: /Refund request/ }).count()))
    await gallery.getByRole("button", { name: /^More templates/ }).tap();
  // On a phone, tapping a template uses it (the gallery closes).
  await gallery.getByRole("option", { name: /Refund request/ }).tap();
  await expect(gallery).toBeHidden();

  // The builder: a decision's settings stack, each a full-width field inside the screen.
  const decide = page.locator(".pb-step.is-if").first();
  const fields = await decide.locator(".proc-step-config select").all();
  expect(fields.length).toBeGreaterThan(1);
  for (const field of fields) {
    const box = (await field.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.width).toBeGreaterThan(250);
  }

  // Running: the step's main button sits at the bottom of the screen, full width.
  await page.getByRole("button", { name: /^Run/ }).first().tap();
  const form = page.getByRole("dialog");
  for (const field of await form.locator('input:not([type="checkbox"])').all()) await field.fill("12");
  await page.getByRole("button", { name: /Start run/ }).tap();
  const next = page.locator(".run-card-actions").getByRole("button").last();
  await expect(next).toBeVisible();
  const button = (await next.boundingBox())!;
  expect(button.y).toBeGreaterThan(844 - 160);
  await expect(page.locator(".run-card-actions .key-hint").first()).toBeHidden();
  await page.getByRole("button", { name: /Pause/ }).tap();

  // The list: the Run button is a round target beside the title, and doesn't squeeze the text.
  await page.goto("/p/playbooks");
  const row = page.locator(".playbook-row", { hasText: "Refund request" });
  const run = (await row.getByRole("button", { name: "Run Refund request" }).boundingBox())!;
  expect(run.width).toBeGreaterThanOrEqual(44);
  expect(run.height).toBeGreaterThanOrEqual(44);
  expect((await row.locator(".playbook-text").boundingBox())!.width).toBeGreaterThan(220);
});

test("search on a phone fills the screen, with Cancel and clear, and no keyboard hints", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect.poll(async () => (await page.locator("aside.sidebar").boundingBox())?.x).toBe(0);
  await page
    .getByRole("button", { name: /^Search/ })
    .first()
    .tap();
  const dialog = page.getByRole("dialog", { name: "Search your workspace" });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(390);
  // The field is ready to type in, with a search keyboard.
  const field = page.getByRole("combobox", { name: "Search workspace" });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("enterkeyhint", "go");
  await expect(dialog.locator(".key-hint").first()).toBeHidden();
  await expect(dialog.locator(".search-footer")).toBeHidden();
  // Clear empties it; Cancel closes search.
  await field.fill("rent");
  await expect(dialog.getByRole("option").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Clear search" }).tap();
  await expect(field).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel" }).tap();
  await expect(dialog).toBeHidden();
});

test("on a phone, a toolbar above the keyboard indents and outdents to-dos (there's no Tab key)", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "Show sidebar" }).tap();
  await expect.poll(async () => (await page.locator("aside.sidebar").boundingBox())?.x).toBe(0);
  await page.getByRole("button", { name: "New page", exact: true }).first().tap();
  await page.getByLabel("Page title", { exact: true }).fill("Errands");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("[] Groceries");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Milk");
  const toolbar = page.getByRole("toolbar", { name: "Editing" });
  await expect(toolbar).toBeVisible();
  const editor = page.getByLabel("Page content", { exact: true });
  // It floats just under the line being edited (clear of the keyboard and browser bars).
  const line = (await editor.locator('ul[data-type="taskList"] > li').last().boundingBox())!;
  await expect
    .poll(async () => Math.round((await toolbar.boundingBox())!.y - (line.y + line.height)))
    .toBeGreaterThanOrEqual(0);
  expect((await toolbar.boundingBox())!.y - (line.y + line.height)).toBeLessThan(24);
  const bar = (await toolbar.boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(390);
  const nested = editor.locator('ul[data-type="taskList"] ul[data-type="taskList"] > li');
  await expect(nested).toHaveCount(0);
  // Indent nests "Milk" under "Groceries"; the cursor (and keyboard) stay in the text.
  await toolbar.getByRole("button", { name: "Indent" }).tap();
  await expect(nested).toHaveCount(1);
  await expect(nested).toContainText("Milk");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".ProseMirror"))).toBe(true);
  // Outdent brings it back (as Shift+Tab does).
  await toolbar.getByRole("button", { name: "Outdent" }).tap();
  await expect(nested).toHaveCount(0);
  await expect(editor.locator('ul[data-type="taskList"] > li')).toHaveCount(2);
  // Done puts the keyboard (and the toolbar) away.
  await toolbar.getByRole("button", { name: "Done" }).tap();
  await expect(toolbar).toBeHidden();
  expect(await page.evaluate(() => !!document.activeElement?.closest(".ProseMirror"))).toBe(false);
});
