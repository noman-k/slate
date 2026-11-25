import { test, expect, type Page } from "@playwright/test";
import { createExampleAccount, deleteAccount, mockApi, signIn, type TestAccount } from "./support";
async function createPage(page: Page, name: string) {
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  // New pages open immediately with the cursor in an empty title, like Notion.
  const title = page.getByLabel("Page title", { exact: true });
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("");
  await title.fill(name);
  await expect(page.getByLabel("Page content", { exact: true })).toBeVisible();
}
/** Picks a template in the gallery, opening "More templates" if it's in there. */
async function openTemplate(page: Page, template: RegExp) {
  const gallery = page.locator(".procedure-gallery");
  await expect(gallery).toBeVisible();
  if (!(await gallery.getByRole("option", { name: template }).count()))
    await gallery.getByRole("button", { name: /^More templates/ }).click();
  await gallery.getByRole("option", { name: template }).click();
}
/** A new page from a playbook template (`kind` only says what the template is for). */
async function startFromTemplate(page: Page, kind: "Playbook" | "Runbook", template: RegExp) {
  void kind;
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByLabel("Start this page").getByRole("button", { name: "Playbook", exact: true }).click();
  await openTemplate(page, template);
  await page.keyboard.press("Enter");
  await expect(page.locator(".procedure-gallery")).toBeHidden();
}
let account: TestAccount | undefined;
test.beforeEach(async ({ page }) => {
  // Leaving a page with unsynced edits asks first; tests always leave.
  page.on("dialog", (dialog) => void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()));
  account = await createExampleAccount();
  await signIn(page, account);
  await page.goto(`/p/${account.ids.ledger}`);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rent Ledger");
});
test.afterEach(async () => {
  await deleteAccount(account);
  account = undefined;
});
test("reference ledger supports live filters and shared board views", async ({ page }) => {
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-04 — Basement", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Follow Up", exact: true }).click();
  await expect(page.getByText("No records match your view.")).toBeVisible();
  await page.getByRole("tab", { name: "Paid", exact: true }).click();
  await expect(page.getByText("9 records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "2 more…", exact: true }).click();
  await page.getByRole("button", { name: "By status", exact: true }).click();
  await expect(page.locator(".db-board")).toBeVisible();
  await expect(page.locator(".db-board-card")).toHaveCount(9);
});
test("Markdown shortcuts, code fences, inline database and refresh are lossless", async ({ page }) => {
  await createPage(page, "Round trip verification");
  const editor = page.getByLabel("Page content", { exact: true });
  await editor.pressSequentially("## ");
  await editor.pressSequentially("Persistent heading");
  await expect(editor.getByRole("heading", { name: "Persistent heading", level: 2 })).toBeVisible();
  await editor.press("Enter");
  await editor.pressSequentially("```");
  await editor.pressSequentially("const answer = 42;");
  await editor.press("ControlOrMeta+End");
  await editor.press("ArrowDown");
  await editor.pressSequentially("/database");
  await editor.press("Enter");
  await expect(editor.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("## Persistent heading");
  await expect(page.locator(".cm-content")).toContainText(':::slate {"kind":"database"');
  await page.getByRole("button", { name: "Interactive", exact: true }).click();
  await expect(editor.locator("pre")).toContainText("const answer = 42;");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Persistent heading", level: 2 })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});
test("two hyphens become an em dash, Backspace undoes it, and --- still makes a divider", async ({ page }) => {
  await createPage(page, "Dash verification");
  const editor = page.getByLabel("Page content", { exact: true });
  await editor.pressSequentially("well--almost");
  await expect(editor.locator("p").first()).toHaveText("well\u2014almost");
  await editor.press("Enter");
  await editor.pressSequentially("a--");
  await editor.press("Backspace");
  await editor.pressSequentially("b");
  await expect(editor.locator("p").nth(1)).toHaveText("a--b");
  await editor.press("Enter");
  await editor.pressSequentially("---");
  await expect(editor.locator("hr")).toHaveCount(1);
  await editor.pressSequentially("```");
  await editor.pressSequentially("x--y");
  await expect(editor.locator("pre")).toContainText("x--y");
  // Titles too, with the same Backspace to undo.
  const title = page.getByRole("textbox", { name: "Page title", exact: true });
  await title.click();
  await title.press("End");
  await title.pressSequentially(" one--two");
  await expect(title).toHaveValue("Dash verification one\u2014two");
  await title.pressSequentially(" a--");
  await title.press("Backspace");
  await title.pressSequentially("b");
  await expect(title).toHaveValue("Dash verification one\u2014two a--b");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue("Dash verification one\u2014two a--b");
});
test("<details> in Markdown becomes a toggle, and a toggle is saved as <details>", async ({ page }) => {
  await createPage(page, "Toggle verification");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(
    "Before\n\n<details>\n<summary>Tax-time review</summary>\n\t- Use year filters\n\t- Keep receipts\n</details>\n\nAfter",
  );
  await page.getByRole("button", { name: "Interactive", exact: true }).click();
  const editor = page.getByLabel("Page content", { exact: true });
  const title = editor.getByRole("textbox", { name: "Toggle title" });
  await expect(title).toHaveValue("Tax-time review");
  const inside = editor.locator(".toggle-content").filter({ hasText: "Use year filters" });
  // It came in closed, as <details> without "open" is.
  await expect(inside).toBeHidden();
  await editor.getByRole("button", { name: "Expand toggle" }).click();
  await expect(inside).toBeVisible();
  await expect(inside.locator("li")).toHaveText(["Use year filters", "Keep receipts"]);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue("Tax-time review");
  await expect(inside).toBeVisible();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("<details open>");
  await expect(page.locator(".cm-content")).toContainText("<summary>Tax-time review</summary>");
  await expect(page.locator(".cm-content")).not.toContainText("slate-node");
});
test("a page with headings gets an outline down the right edge that follows along and jumps to them", async ({
  page,
}) => {
  await createPage(page, "Outline verification");
  const editor = page.getByLabel("Page content", { exact: true });
  const outline = page.getByRole("navigation", { name: "Page outline" });
  const section = async (heading: string, marks: string) => {
    await editor.pressSequentially(`${marks} ${heading}`);
    await editor.press("Enter");
    for (let line = 0; line < 24; line++) {
      await page.keyboard.insertText(`${heading} line ${line + 1}`);
      await editor.press("Enter");
    }
  };
  await editor.click();
  await section("Plan", "#");
  // One heading is not worth an outline.
  await expect(outline).toHaveCount(0);
  await section("Details", "##");
  await section("Wrap up", "##");
  await expect(outline).toBeVisible();
  const lines = outline.locator(".page-outline-line");
  await expect(lines).toHaveCount(3);
  // Smaller headings get shorter lines.
  const widths = await lines.evaluateAll((all) => all.map((el) => el.getBoundingClientRect().width));
  expect(widths[0]).toBeGreaterThan(widths[1]);
  const scroller = page.locator("main.page-scroll");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  await expect(lines.nth(0)).toHaveClass(/is-active/);
  // Its names show when you point at it; picking one goes there.
  const wrapUp = outline.getByRole("button", { name: "Wrap up", exact: true });
  await expect(wrapUp).toBeHidden();
  await outline.hover();
  await expect(wrapUp).toBeVisible();
  await expect(outline.getByRole("button", { name: "Plan", exact: true })).toHaveAttribute("aria-current", "location");
  await wrapUp.click();
  const heading = editor.getByRole("heading", { name: "Wrap up" });
  await expect
    .poll(async () => {
      const [top, box] = await Promise.all([
        scroller.evaluate((el) => el.getBoundingClientRect().top),
        heading.boundingBox(),
      ]);
      return Math.abs(box!.y - top);
    })
    .toBeLessThan(80);
  await expect(lines.nth(2)).toHaveClass(/is-active/);
  // Scrolling by hand moves the lit line too.
  await page.mouse.move(400, 400);
  await expect(wrapUp).toBeHidden();
  await page.mouse.wheel(0, -100000);
  await expect(lines.nth(0)).toHaveClass(/is-active/);
});
test("dragging a column wider between pixels still saves, as a whole-pixel width", async ({ page }) => {
  const handle = page.getByRole("separator", { name: /^Resize / }).first();
  const before = Number(await handle.getAttribute("aria-valuenow"));
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // A zoomed browser reports the pointer between pixels like this.
  await page.mouse.move(x + 20.37, y, { steps: 4 });
  await page.mouse.move(x + 40.61, y, { steps: 4 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", String(before + 41));
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText(/could not be synced/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("separator", { name: /^Resize / }).first()).toHaveAttribute(
    "aria-valuenow",
    String(before + 41),
  );
});
test("a long record name wraps in the side panel, and several tags in a cell keep their names whole", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open 2026-04 — Basement", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Record title", exact: true });
  const oneLine = (await title.boundingBox())!.height;
  await title.fill("Horse Shipping — Azure Resource Provisioning Blocked by a Missing Subscription Quota");
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // Tags in a narrow cell: none is squeezed (each is as wide as its name), the extra fade at the edge.
  const cell = page.locator(".db-select-trigger").first();
  await cell.evaluate((button) => {
    button.style.width = "180px";
    button.replaceChildren(
      ...["Operations", "Database", "Deployment"].map((name) =>
        Object.assign(document.createElement("span"), { className: "db-badge", textContent: name }),
      ),
    );
  });
  const badges = await cell.locator(".db-badge").evaluateAll((all) => all.map((b) => b.scrollWidth - b.clientWidth));
  expect(badges).toEqual([0, 0, 0]);
  expect(await cell.evaluate((el) => getComputedStyle(el).maskImage)).toContain("gradient");
});
test("records have private persistent URLs and editable page content", async ({ page }) => {
  // Clicking a name renames it; the "Open" button opens the record.
  await page.getByRole("button", { name: "Open 2026-04 — Basement", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]+$/);
  // An existing record opens to be read: the panel has focus, no field is being edited.
  await expect(page.getByRole("dialog")).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Record title", exact: true })).not.toBeFocused();
  await page.getByRole("textbox", { name: "Record title", exact: true }).fill("Updated April rent");
  await page.getByLabel("Page content", { exact: true }).pressSequentially("Payment receipt received.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Record title", exact: true })).toHaveValue("Updated April rent");
  await expect(page.getByLabel("Page content", { exact: true })).toContainText("Payment receipt received.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Updated April rent", exact: true })).toBeVisible();
});
test("deleted page trees can be restored from Trash", async ({ page }) => {
  await createPage(page, "Recoverable note");
  await page.getByRole("button", { name: "Page options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Recoverable note");
  await page.getByRole("button", { name: "Restore Recoverable note", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // The restored page is also the open page, so its name appears in the breadcrumb too.
  await page
    .getByRole("complementary", { name: "Workspace navigation" })
    .getByRole("button", { name: "Recoverable note", exact: true })
    .click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Recoverable note");
});
test("a new page can start as a database instead", async ({ page }) => {
  await createPage(page, "Reading list");
  const starter = page.getByLabel("Start this page");
  await expect(starter).toBeVisible();
  await starter.getByRole("button", { name: "Board", exact: true }).click();
  await expect(starter).toBeHidden();
  await expect(page.locator(".db-board")).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Reading list");
  await page.reload();
  await expect(page.locator(".db-board")).toBeVisible();
});
test("theme can be switched in settings and is remembered", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("front page links into the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Signed in, the front page offers the way back into the workspace.
  await page.getByRole("link", { name: "Open Slate" }).first().click();
  // The dev server may compile the app on this first visit: allow it a moment.
  await expect(page).toHaveURL(/\/(app|p\/[0-9a-f-]+)$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Slate home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
test("subpages are listed in their parent, can become blocks, and follow moves", async ({ page }) => {
  await createPage(page, "Trip plans");
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const parentRow = sidebar.locator(".tree-row", { hasText: "Trip plans" });
  await parentRow.hover();
  await parentRow.getByRole("button", { name: "Add a page inside Trip plans" }).click();
  await page.getByLabel("Page title", { exact: true }).fill("Packing list");
  // The parent lists it under Pages inside; "Add to page" makes it a block in the text.
  await parentRow.locator(".tree-page").click();
  await expect(page.getByRole("region", { name: "Pages inside" })).toContainText("Packing list");
  await page.getByRole("region", { name: "Pages inside" }).getByRole("button", { name: "Add to page" }).click();
  const block = page.locator(".page-body .slate-prose .editor-page-reference", { hasText: "Packing list" });
  await expect(block).toBeVisible();
  await expect(page.locator(".pages-inside")).toHaveCount(0);
  // Opening a page must not leave a block selected: it lights up once the editor
  // gains focus (Safari focuses it when you click a page link).
  await expect(page.locator(".ProseMirror-selectednode")).toHaveCount(0);
  // Clicking the block must not select it (that flashed a blue ring before the page
  // opened). Hold back one click from opening so the editor's reaction is visible.
  await page.locator(".page-body .slate-prose p").last().click();
  await page.evaluate(() =>
    window.addEventListener("click", (event) => event.stopImmediatePropagation(), {
      capture: true,
      once: true,
    }),
  );
  await block.locator("span").click();
  await expect(page.locator(".ProseMirror-focused .ProseMirror-selectednode")).toHaveCount(0);
  // A normal click opens it.
  await block.click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Packing list");
  // Moving it to the top level removes the block from the old parent.
  const childRow = sidebar.locator(".tree-row", { hasText: "Packing list" });
  await childRow.hover();
  await childRow.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Private pages/ })
    .click();
  await parentRow.locator(".tree-page").click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Trip plans");
  await expect(page.locator(".page-body .editor-page-reference", { hasText: "Packing list" })).toHaveCount(0);
});
test("slash menu works from the keyboard", async ({ page }) => {
  await createPage(page, "Keyboard menu");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Insert a block" });
  await expect(menu).toBeVisible();
  const selected = menu.locator('[aria-selected="true"]');
  await expect(selected).toContainText("Text");
  // A mouse resting over the menu must not steal the highlight while the list scrolls.
  const box = (await menu.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await expect(selected).toContainText("To-do list");
  // The highlighted option is fully visible, not tucked under the sticky footer.
  const footer = (await menu.locator(".slash-menu-footer").boundingBox())!;
  const option = (await selected.boundingBox())!;
  expect(option.y + option.height).toBeLessThanOrEqual(footer.y + 1);
  expect(option.y).toBeGreaterThanOrEqual(box.y);
  // End/Home jump to the ends; Up from the top wraps to the bottom.
  await page.keyboard.press("End");
  const last = await selected.textContent();
  await page.keyboard.press("Home");
  await expect(selected).toContainText("Text");
  await page.keyboard.press("ArrowUp");
  await expect(selected).toHaveText(last!);
  // Filtering keeps working, and Enter inserts the highlighted block.
  await page.keyboard.type("todo");
  await expect(selected).toContainText("To-do list");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(page.locator(".page-body ul[data-type='taskList']")).toHaveCount(1);
  // Escape keeps the "/" as text, and typing on doesn't reopen the menu.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.keyboard.type("he");
  await expect(menu).toBeHidden();
});
test("rows of an embedded database open over the current page", async ({ page }) => {
  await createPage(page, "Reading");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/database");
  await page.keyboard.press("Enter");
  const embedded = page.locator(".db-compact");
  await embedded.getByRole("button", { name: "New page" }).first().click();
  await page.keyboard.press("Escape");
  const url = page.url();
  await embedded.locator(".db-open-peek").first().click();
  // The record peeks in from the side; the page underneath stays put.
  const peek = page.getByRole("dialog");
  await expect(peek.getByLabel("Record title")).toBeVisible();
  // The new row has no name yet, so its title is focused, ready to be named.
  await expect(peek.getByLabel("Record title")).toHaveValue("");
  await expect(peek.getByLabel("Record title")).toBeFocused();
  expect(page.url()).toBe(url);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Reading");
  await page.keyboard.press("Escape");
  await expect(peek).toBeHidden();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Reading");
  // "Open as full page" still takes you to the record itself.
  await embedded.locator(".db-open-peek").first().click();
  await page.getByRole("button", { name: "Open as full page" }).click();
  await expect(page).not.toHaveURL(url);
  await expect(page.getByRole("dialog")).toBeHidden();
  // The embedded database's title opens the database's own page.
  await page.goto(url);
  await page.getByRole("button", { name: /^Open .* as a full page$/ }).click();
  await expect(page.locator(".database-page .db-toolbar")).toBeVisible();
});
test("a page can show an existing database as a linked view", async ({ page }) => {
  await createPage(page, "Dashboard");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/linked");
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Add a database" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("option", { name: /New database/ })).toBeVisible();
  // Search ranks name matches first; Enter links the highlighted database.
  await page.keyboard.type("ten");
  await expect(picker.locator('[aria-selected="true"]')).toContainText("Tenants");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  const embedded = page.locator(".db-compact");
  await expect(embedded.locator(".db-inline-title")).toContainText("Tenants");
  await expect(embedded.locator(".db-linked-badge")).toBeVisible();
  await expect(embedded.getByText("Alex Morgan")).toBeVisible();
  // It's a view of the same database, not a copy, and not one of this page's children.
  await expect(page.locator(".pages-inside")).toHaveCount(0);
  // "New database" from the picker creates a fresh one instead.
  await page.keyboard.press("End");
  await page.keyboard.type("/linked");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator(".db-compact")).toHaveCount(2);
  await expect(page.locator(".db-compact").nth(1).locator(".db-linked-badge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Deleting a linked view only removes the view; the original database stays.
  const linkedBlock = page.locator(".slate-prose .react-renderer", { has: page.locator(".db-linked-badge") });
  const box = (await linkedBlock.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 14);
  await page.getByRole("button", { name: "Block actions" }).click();
  await page.locator(".editor-context-menu").getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Removed the view of “Tenants”. The database itself is unchanged.")).toBeVisible();
  await expect(page.getByRole("complementary").locator(".tree-title", { hasText: /^Tenants$/ })).toBeVisible();
});
test("the sidebar marks the open page in the tree and reveals it", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const tree = sidebar.locator('section[aria-label="Private"]');
  const row = (title: string) => tree.locator(".tree-row", { hasText: title }).locator(".tree-page");
  // Open "Getting started", then "Workspace notes": Recents shows where you were.
  await row("Getting started").click();
  await row("Workspace notes").click();
  const recents = sidebar.locator('section[aria-label="Recents"]');
  await expect(recents.getByRole("button", { name: "Workspace notes, recent" })).toHaveCount(0);
  await expect(recents.getByRole("button", { name: "Getting started, recent" })).toBeVisible();
  // The tree row is the "you are here" mark.
  await expect(tree.locator('[aria-current="page"]')).toHaveText("Workspace notes");
  // Collapse the hub, then open a page nested inside it from search: the tree opens up to it.
  await tree.getByRole("button", { name: "Collapse Rental Property Finance Hub" }).click();
  await expect(row("Rent Ledger")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Rent Ledger");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rent Ledger");
  await expect(tree.locator('[aria-current="page"]')).toContainText("Rent Ledger");
  await expect(tree.locator('[aria-current="page"]')).toBeInViewport();
});
test("switching pages keeps your place and offers a quick way back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await createPage(page, "Long read");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(Array.from({ length: 80 }, (_, i) => `Paragraph ${i}\n`).join("\n"));
  await page.getByRole("button", { name: "Interactive", exact: true }).click();
  const scroller = page.locator(".page-scroll");
  await scroller.evaluate((el) => (el.scrollTop = 900));
  await page.waitForTimeout(100);
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const row = (title: string) =>
    sidebar.locator('section[aria-label="Private"] .tree-row', { hasText: title }).locator(".tree-page");
  // Clicking the page you're on twice doesn't add history.
  await row("Getting started").click();
  await row("Getting started").click();
  const title = page.getByLabel("Page title", { exact: true });
  await expect(title).toHaveValue("Getting started");
  await expect(scroller).toHaveJSProperty("scrollTop", 0);
  // ⌘[ goes back, to where you were reading.
  await page.locator("body").press("ControlOrMeta+BracketLeft");
  await expect(title).toHaveValue("Long read");
  await expect.poll(() => scroller.evaluate((el) => Math.round(el.scrollTop))).toBeGreaterThan(850);
  // ⌘] goes forward again.
  await page.locator("body").press("ControlOrMeta+BracketRight");
  await expect(title).toHaveValue("Getting started");
  // ⌘K with nothing typed lists the page you just left first: Enter takes you back.
  await page.keyboard.press("ControlOrMeta+k");
  const results = page.getByRole("listbox", { name: "Search results" });
  await expect(results.getByText("Recent pages")).toBeVisible();
  await expect(results.locator(".search-result").first()).toContainText("Long read");
  await page.keyboard.press("Enter");
  await expect(title).toHaveValue("Long read");
});
test("new table rows open for typing, and rows can be dragged into place", async ({ page }) => {
  await createPage(page, "Books");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/database");
  await page.keyboard.press("Enter");
  const table = page.locator(".db-compact .db-table");
  // "New page" adds a row with its title ready for typing.
  for (const name of ["Dune", "Neuromancer"]) {
    await page.locator(".db-compact").getByRole("button", { name: "New page" }).first().click();
    const input = table.getByLabel("Edit Name");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
  }
  const titles = () => table.locator("tbody .db-title-text span").allTextContents();
  await expect.poll(titles).toEqual(["Dune", "Neuromancer"]);
  // Drag "Neuromancer" above "Dune": a drop line shows, and the row lands there.
  const rows = table.locator("tbody tr").filter({ has: page.locator(".db-title-text") });
  await rows.nth(1).hover();
  const handle = rows.nth(1).getByRole("button", { name: "Actions for Neuromancer" });
  await handle.dragTo(rows.nth(0), { targetPosition: { x: 60, y: 4 } });
  await expect.poll(titles).toEqual(["Neuromancer", "Dune"]);
});
test("blocks can be moved with their drag handle", async ({ page }) => {
  await createPage(page, "Blocks");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("First");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/database");
  await page.keyboard.press("Enter");
  const blocks = () =>
    page.evaluate(() =>
      [...document.querySelector(".slate-prose")!.children]
        .map((el) => (el.querySelector(".db-inline-title") ? "database" : el.textContent || ""))
        .filter(Boolean),
    );
  const drag = async (from: import("@playwright/test").Locator, to: import("@playwright/test").Locator) => {
    const b = (await from.boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 12);
    const grip = page.getByRole("button", { name: "Block actions" });
    await expect(grip).toBeVisible();
    const g = (await grip.boundingBox())!;
    const t = (await to.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 100, t.y + 3, { steps: 8 });
    await expect(page.locator(".block-drop-line")).toBeVisible();
    await page.mouse.up();
  };
  const paragraphs = page.locator(".slate-prose > p");
  await drag(paragraphs.nth(1), paragraphs.first());
  await expect.poll(blocks).toEqual(["Second", "First", "database"]);
  // A database block moves the same way.
  await drag(page.locator(".slate-prose .react-renderer").first(), paragraphs.first());
  await expect.poll(blocks).toEqual(["database", "Second", "First"]);
  // A click (no drag) opens the block menu.
  const second = (await paragraphs.first().boundingBox())!;
  await page.mouse.move(second.x + 40, second.y + 12);
  await page.getByRole("button", { name: "Block actions" }).click();
  await expect(page.locator(".editor-context-menu")).toBeVisible();
});

test("clicking a row's name renames it; Open opens it in the side panel", async ({ page }) => {
  const name = page.getByRole("button", { name: "2026-05 — Basement", exact: true });
  await name.click();
  const input = page.getByLabel("Edit Rent Entry");
  await expect(input).toBeFocused();
  await input.fill("2026-05 — Basement (paid)");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "2026-05 — Basement (paid)", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open 2026-05 — Basement (paid)", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Record title")).toHaveValue("2026-05 — Basement (paid)");
});

test("a table row's grip opens its menu on click", async ({ page }) => {
  const row = page.locator(".db-table tbody tr").filter({ hasText: "2026-11 — Basement" });
  await row.hover();
  // Table rows no longer have a separate "⋯" at the far end.
  await expect(row.locator(".db-row-menu-trigger")).toHaveCount(0);
  const grip = page.getByRole("button", { name: "Actions for 2026-11 — Basement", exact: true });
  await grip.click();
  const menu = page.getByRole("dialog", { name: "Record actions" });
  await expect(menu.getByText("Open in side panel")).toBeVisible();
  await menu.getByText("Duplicate").click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".db-table tbody tr").filter({ hasText: "2026-11 — Basement" })).toHaveCount(2);
  // Keyboard: Enter on the grip opens the same menu.
  await grip.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Record actions" })).toBeVisible();
});
test("table rows can be selected together and moved to the Trash, with Undo", async ({ page }) => {
  const rows = page.locator(".db-table tbody tr:not(.db-add-tr)");
  const total = await rows.count();
  const bar = page.getByRole("toolbar", { name: "Selected rows" });
  // A checkbox beside each row; Shift-click selects everything in between.
  await rows.nth(0).hover();
  await rows.nth(0).getByRole("checkbox").click();
  await expect(bar).toContainText("1 selected");
  await expect(rows.nth(0)).toHaveClass(/is-selected/);
  await rows
    .nth(2)
    .getByRole("checkbox")
    .click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("3 selected");
  await expect(page.getByRole("checkbox", { name: "Select all rows" })).toHaveAttribute("aria-checked", "mixed");
  // Esc lets go.
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  // The header selects them all; clicking again lets go.
  await page.locator(".db-table thead tr").hover();
  await page.getByRole("checkbox", { name: "Select all rows" }).click();
  await expect(bar).toContainText(`${total} selected`);
  await page.getByRole("checkbox", { name: "Deselect all rows" }).click();
  await expect(bar).toBeHidden();
  // Delete (the key, or the bar's button) moves them to the Trash, and Undo brings them back.
  const first = (await rows.nth(0).getByRole("checkbox").getAttribute("aria-label"))!.replace(/^Select /, "");
  await rows.nth(0).hover();
  await rows.nth(0).getByRole("checkbox").click();
  await rows.nth(1).hover();
  await rows.nth(1).getByRole("checkbox").click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("2 rows moved to Trash")).toBeVisible();
  await expect(rows).toHaveCount(total - 2);
  await expect(bar).toBeHidden();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(total);
  await expect(page.getByRole("checkbox", { name: `Select ${first}`, exact: true })).toHaveCount(1);
  await rows.nth(0).hover();
  await rows.nth(0).getByRole("checkbox").click();
  await bar.getByRole("button", { name: "Delete" }).click();
  await expect(rows).toHaveCount(total - 1);
});

test("filters and sorts work like Notion: pills, And/Or groups, typed values and several sorts", async ({ page }) => {
  const rows = page.locator(".db-table tbody tr:not(.db-add-tr):not(.db-empty-row)");
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  const bar = page.getByRole("toolbar", { name: "Sorts and filters" });

  // Filter: pick a property, then its value from its own choices. The pill says what it does.
  await page.getByRole("button", { name: "Filter records" }).click();
  await page.getByRole("dialog", { name: "Filter by" }).getByRole("button", { name: "Status" }).click();
  const rule = page.getByRole("dialog", { name: "Filter", exact: true });
  // Until it has a value it hides nothing.
  await expect(rows).toHaveCount(total);
  await rule.getByRole("combobox", { name: "Filter value" }).selectOption("Pending");
  await expect(bar.getByRole("button", { name: "Status: Pending" })).toBeVisible();
  await expect(page.getByText("No records match your view.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Advanced: Status is Pending, or (Amount Received > 1400).
  await bar.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("dialog", { name: "Add a filter" }).getByRole("button", { name: "Add advanced filter" }).click();
  const advanced = page.getByRole("dialog", { name: "Advanced filter" });
  await advanced.getByRole("combobox", { name: "Match" }).selectOption("or");
  const grouped = advanced.locator(".db-rules-group.is-nested");
  await grouped.getByRole("combobox", { name: "Filter property" }).selectOption({ label: "Amount Received" });
  await grouped.getByRole("combobox", { name: "Filter condition" }).selectOption(">");
  await grouped
    .getByRole("textbox", { name: "Filter value" })
    .or(grouped.getByRole("spinbutton", { name: "Filter value" }))
    .fill("1400");
  await expect(rows).toHaveCount(2);
  await expect(bar.getByRole("button", { name: "2 rules" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Sorts: pick a property, then change direction; it's kept when the page reloads.
  await page.getByRole("button", { name: "Sort records" }).click();
  await page.getByRole("dialog", { name: "Sort by" }).getByRole("button", { name: "Amount Received" }).click();
  const sorts = page.getByRole("dialog", { name: "Sorts" });
  await sorts.getByRole("combobox", { name: "Sort direction" }).selectOption("desc");
  await sorts.getByRole("button", { name: "Add sort" }).click();
  await expect(sorts.getByRole("combobox", { name: "Sort property" })).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: "2 sorts" })).toBeVisible();
  await expect(rows.first()).toContainText("$2,600.00");
  await page.reload();
  await expect(
    page.getByRole("toolbar", { name: "Sorts and filters" }).getByRole("button", { name: "2 rules" }),
  ).toBeVisible();
  await expect(rows).toHaveCount(2);

  // Delete filter and sort: everything shows again, in its own order.
  await page.getByRole("button", { name: "2 rules" }).click();
  await page.getByRole("dialog", { name: "Advanced filter" }).getByRole("button", { name: "Delete filter" }).click();
  await page.getByRole("button", { name: "2 sorts" }).click();
  await page.getByRole("dialog", { name: "Sorts" }).getByRole("button", { name: "Delete sort" }).click();
  await expect(rows).toHaveCount(total);
  await expect(page.getByRole("toolbar", { name: "Sorts and filters" })).toHaveCount(0);
});

test("a record opens over its database without scrolling it, and lists every linked record", async ({ page }) => {
  // A short window, so the database page scrolls.
  await page.setViewportSize({ width: 1280, height: 520 });
  const scroller = page.locator("main.page-scroll, main").first();
  const scrollTop = () =>
    page.evaluate(() => {
      const main = [...document.querySelectorAll("main")].find((el) => el.scrollHeight > el.clientHeight);
      return main ? Math.round(main.scrollTop) : -1;
    });
  await page.evaluate(() => {
    const main = [...document.querySelectorAll("main")].find((el) => el.scrollHeight > el.clientHeight)!;
    main.scrollTop = 260;
  });
  const before = await scrollTop();
  expect(before).toBeGreaterThan(100);
  await expect(scroller).toBeVisible();

  // On another view than the first; the database underneath must stay exactly as it is.
  await page.getByRole("tab", { name: "Paid" }).click();
  await expect(page.getByRole("tab", { name: "Paid" })).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => {
    (document.querySelector(".database-view") as HTMLElement).dataset.probe = "same";
  });
  // Link a second tenant to a row, then open it in the side panel.
  const row = page.locator(".db-table tbody tr").filter({ hasText: "2026-06 — Basement" });
  const trigger = row.locator(".db-relation-trigger");
  const box = (await trigger.boundingBox())!;
  await trigger.click({ position: { x: box.width - 8, y: box.height / 2 } });
  const picker = page.locator(".db-menu", { has: page.getByLabel("Search related records") });
  await picker.getByLabel("Search related records").fill("Bea Brown");
  await picker.getByRole("button", { name: /Create “Bea Brown” in Tenants/ }).click();
  await expect(row.locator(".db-cell-anchor")).toHaveText("Alex Morgan+1");
  const kept = await scrollTop();
  await row.getByRole("button", { name: "Open 2026-06 — Basement", exact: true }).click();
  const panel = page.getByRole("dialog").filter({ has: page.getByLabel("Record title") });
  await expect(panel.getByLabel("Record title")).toHaveValue("2026-06 — Basement");
  // The database behind stays where it was: same view, same scroll, not rebuilt. (The
  // panel hides the page behind from screen readers, so look at the tab itself.)
  expect(await scrollTop()).toBe(kept);
  await expect(page.locator(".db-view-tab.active")).toHaveText("Paid");
  expect(await page.evaluate(() => (document.querySelector(".database-view") as HTMLElement).dataset.probe)).toBe(
    "same",
  );
  // Every linked record, one per line (no "+1").
  const chips = panel.locator(".db-record-properties .db-relation-chip");
  await expect(chips).toHaveText(["Alex Morgan", "Bea Brown"]);
  await expect(panel.locator(".db-record-properties .db-relation-more")).toHaveCount(0);
  const [first, second] = [(await chips.nth(0).boundingBox())!, (await chips.nth(1).boundingBox())!];
  expect(second.y).toBeGreaterThan(first.y + first.height - 2);
  // A name opens that record; the empty space beside the names opens the picker.
  await chips.nth(1).click();
  await expect(panel.getByLabel("Record title")).toHaveValue("Bea Brown");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await scrollTop()).toBe(kept);
  await expect(page.getByRole("tab", { name: "Paid" })).toHaveAttribute("aria-selected", "true");
  // Away and back: the database opens on the view it was left on.
  await page.locator("aside.sidebar").getByText("Getting started", { exact: true }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  await page.goBack();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rent Ledger");
  await expect(page.getByRole("tab", { name: "Paid" })).toHaveAttribute("aria-selected", "true");
});

test("database views can be put in another order, by dragging a tab or from View settings", async ({ page }) => {
  const tabs = page.getByRole("tablist", { name: "Database views" }).getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  const before = await tabs.allTextContents();
  // Drag the third tab onto the left half of the first: it goes first.
  const first = (await tabs.nth(0).boundingBox())!;
  await tabs.nth(2).dragTo(tabs.nth(0), { targetPosition: { x: 4, y: first.height / 2 } });
  await expect(tabs).toHaveText([before[2], before[0], before[1], ...before.slice(3)]);
  // From View settings: the open view moves one place right.
  await tabs.nth(0).click();
  await page.getByRole("button", { name: "View settings" }).click();
  await page.getByRole("button", { name: "Move view right" }).click();
  await expect(tabs).toHaveText([before[0], before[2], before[1], ...before.slice(3)]);
  await page.keyboard.press("Escape");
  // It's kept.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("slate-pending:"))))
    .toBe(false);
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Database views" }).getByRole("tab")).toHaveText([
    before[0],
    before[2],
    before[1],
    ...before.slice(3),
  ]);
});

test("pages and databases move to another workspace, with everything in them", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  // A second workspace, then back to the first.
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  await page.getByLabel("Workspace name").fill("Side project");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(sidebar.getByRole("button", { name: "Workspace: Side project" })).toBeVisible();
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: /Home/ }).first().click();
  await expect(sidebar.getByRole("button", { name: "Workspace: Home" })).toBeVisible();

  // The open database moves; its Tenant relation would cross workspaces, so it asks first.
  await page.goto(`/p/${account!.ids.ledger}`);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rent Ledger");
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("menuitem", { name: "Move to", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move “Rent Ledger”" });
  await dialog.getByRole("radio", { name: /Side project/ }).click();
  await expect(dialog).toContainText("To Side project, with everything in it (its 9 rows).");
  await dialog.getByRole("button", { name: /Private pages/ }).click();
  const confirm = page.getByRole("dialog", { name: "Move “Rent Ledger” to Side project?" });
  await expect(confirm).toContainText("“Tenant” in Rent Ledger, which links to Tenants");
  await confirm.getByRole("button", { name: "Move to Side project" }).click();
  await expect(page.getByText("Moved “Rent Ledger” to Side project")).toBeVisible();
  // What was open went with it: Slate follows it to its new workspace, rows and all.
  await expect(sidebar.getByRole("button", { name: "Workspace: Side project" })).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Rent Ledger");
  await expect(page.locator(".db-table tbody tr").filter({ hasText: "2026-04 — Basement" })).toHaveCount(1);
  await expect(sidebar.getByText("Rent Ledger", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("complementary", { name: "Workspace navigation" })
      .getByRole("button", { name: "Workspace: Side project" }),
  ).toBeVisible();
  await expect(page.locator(".db-table tbody tr").filter({ hasText: "2026-04 — Basement" })).toHaveCount(1);

  // A page with nothing to unlink moves straight away, and Undo brings it back.
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: /Home/ }).first().click();
  await expect(sidebar.getByRole("button", { name: "Workspace: Home" })).toBeVisible();
  await expect(sidebar.getByText("Rent Ledger", { exact: true })).toHaveCount(0);
  const guide = sidebar.getByText("Getting started", { exact: true });
  await guide.click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("menuitem", { name: "Move to", exact: true }).click();
  await page.getByRole("radio", { name: /Side project/ }).click();
  await page
    .getByRole("dialog", { name: "Move “Getting started”" })
    .getByRole("button", { name: /Private pages/ })
    .click();
  await expect(page.getByText("Moved “Getting started” to Side project")).toBeVisible();
  // It was open, so Slate went with it; Undo takes it (and you) back.
  await expect(sidebar.getByRole("button", { name: "Workspace: Side project" })).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  await page
    .locator("[data-sonner-toast]", { hasText: "Moved “Getting started” to Side project" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.getByText("Moved “Getting started” to Home")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Workspace: Home" })).toBeVisible();
  await expect(sidebar.getByText("Getting started", { exact: true })).toBeVisible();
});

test("a row added in a filtered view starts with what the filter asks, and stays in view", async ({ page }) => {
  const rows = page.locator(".db-table tbody tr:not(.db-add-tr):not(.db-empty-row)");
  await expect(rows.first()).toBeVisible();
  // Status is Pending: nothing matches yet.
  await page.getByRole("button", { name: "Filter records" }).click();
  await page.getByRole("dialog", { name: "Filter by" }).getByRole("button", { name: "Status" }).click();
  await page
    .getByRole("dialog", { name: "Filter", exact: true })
    .getByRole("combobox", { name: "Filter value" })
    .selectOption("Pending");
  await page.keyboard.press("Escape");
  await expect(page.getByText("No records match your view.")).toBeVisible();
  // A new row is Pending, so it's right there to type in.
  await page.getByRole("button", { name: "New page" }).last().click();
  await page.keyboard.type("Late fee");
  await page.keyboard.press("Enter");
  const added = rows.filter({ hasText: "Late fee" });
  await expect(added).toHaveCount(1);
  await expect(added).toContainText("Pending");
  // A rule that can't be filled in ("Amount Due > 999999") still leaves new rows in view while you're here…
  await page.getByRole("button", { name: "Filter records" }).click();
  await page.getByRole("dialog", { name: "Filter by" }).getByRole("button", { name: "Amount Due" }).click();
  const amount = page.getByRole("dialog", { name: "Filter", exact: true });
  await amount.getByRole("combobox", { name: "Filter condition" }).selectOption(">");
  await amount.getByRole("spinbutton", { name: "Filter value" }).fill("999999");
  await page.keyboard.press("Escape");
  // Only the row just added is left (it was added here, so it stays).
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "New page" }).last().click();
  await page.keyboard.type("Deposit refund");
  await page.keyboard.press("Enter");
  await expect(rows.filter({ hasText: "Deposit refund" })).toHaveCount(1);
  // …and once you leave the view and come back, it's filtered like any row.
  const tabs = page.getByRole("tablist", { name: "Database views" }).getByRole("tab");
  const current = (await page.locator(".db-view-tab.active").textContent())!.trim();
  await tabs.filter({ hasNotText: current }).first().click();
  await tabs.filter({ hasText: current }).first().click();
  await expect(rows.filter({ hasText: "Deposit refund" })).toHaveCount(0);
});

test("while the workspace loads, the page and sidebar show their shape, and nothing claims to be saved", async ({
  page,
}) => {
  // Hold the workspace back for a moment.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/rest/v1/rpc/load_workspace_state", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/app");
  await expect(page.getByRole("status", { name: "Opening your workspace…" })).toBeVisible();
  await expect(page.locator(".skeleton-sidebar")).toBeVisible();
  await expect(page.getByText("No pages yet.")).toHaveCount(0);
  await expect(page.getByText("Saved", { exact: true })).toBeHidden();
  release();
  // Then the real page takes its place.
  await expect(page.getByLabel("Page title", { exact: true })).toBeVisible();
  await expect(page.locator(".skeleton-page, .skeleton-sidebar")).toHaveCount(0);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("a database can open its records as full pages", async ({ page }) => {
  const title = page.getByLabel("Page title", { exact: true });
  // Default: the side panel.
  await page.getByRole("button", { name: "View settings" }).click();
  const setting = page.getByRole("radiogroup", { name: "Open records in" });
  await expect(setting.getByRole("radio", { name: "Side panel" })).toHaveAttribute("aria-checked", "true");
  await setting.getByRole("radio", { name: "Full page" }).click();
  await page.keyboard.press("Escape");
  // Now Open goes straight to the record as a page, and the menus say so.
  await page.getByRole("button", { name: "Open 2026-04 — Basement", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(title).toHaveValue("2026-04 — Basement");
  // Back returns to the database; Forward brings the full page back.
  await page.goBack();
  await expect(title).toHaveValue("Rent Ledger");
  await page.goForward();
  await expect(title).toHaveValue("2026-04 — Basement");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goBack();
  // Switch back to the side panel; ⌘/Ctrl-click still opens a full page once.
  await page.getByRole("button", { name: "View settings" }).click();
  await page.getByRole("radiogroup", { name: "Open records in" }).getByRole("radio", { name: "Side panel" }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open 2026-05 — Basement", exact: true })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(title).toHaveValue("2026-05 — Basement");
  await page.goBack();
  await page.getByRole("button", { name: "Open 2026-05 — Basement", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Record title")).toHaveValue("2026-05 — Basement");
});
test("pages can be dragged above, below or inside others in the sidebar", async ({ page }) => {
  const tree = page.locator('section[aria-label="Private"]');
  const row = (title: string) =>
    tree.locator(".tree-row", { has: page.locator(".tree-title", { hasText: new RegExp(`^${title}$`) }) });
  const outline = () =>
    tree
      .locator(".tree-row")
      .evaluateAll((rows) =>
        rows.map(
          (r) =>
            `${(r as HTMLElement).style.getPropertyValue("--depth")}:${r.querySelector(".tree-title")?.textContent}`,
        ),
      );
  const drag = async (from: string, to: string, at: number) => {
    const a = (await row(from).boundingBox())!;
    const b = (await row(to).boundingBox())!;
    await page.mouse.move(a.x + 80, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 80, a.y + a.height / 2 + 12, { steps: 3 });
    await page.mouse.move(b.x + 80, b.y + b.height * at, { steps: 8 });
    await page.mouse.move(b.x + 81, b.y + b.height * at, { steps: 2 });
    await page.mouse.up();
  };
  // Above: "Workspace notes" moves before "Getting started" (an insert, not a swap).
  await drag("Workspace notes", "Getting started", 0.1);
  await expect
    .poll(async () => (await outline()).filter((r) => r.startsWith("0:")))
    .toEqual(["0:Rental Property Finance Hub", "0:Workspace notes", "0:Getting started"]);
  // Inside: "Getting started" nests under "Workspace notes", with an Undo toast.
  await drag("Getting started", "Workspace notes", 0.5);
  await expect.poll(outline).toContain("1:Getting started");
  await expect(page.getByText("Moved to Workspace notes")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(outline).toContain("0:Getting started");
  // Out to the top level: "Tenants" (inside the hub) dropped below "Getting started".
  await drag("Tenants", "Getting started", 0.9);
  await expect.poll(async () => (await outline()).slice(-1)).toEqual(["0:Tenants"]);
});
test("databases made in a page: name them inline, pick a view, delete with undo", async ({ page }) => {
  await createPage(page, "Planning");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  // /database: the name is ready for typing right away.
  await page.keyboard.type("/database");
  await page.keyboard.press("Enter");
  const name = page.getByLabel("Database name");
  await expect(name).toBeFocused();
  await page.keyboard.type("Books");
  await page.keyboard.press("Enter");
  const embedded = page.locator(".db-compact");
  await expect(embedded.locator(".db-inline-title")).toContainText("Books");
  await expect(page.getByRole("complementary").locator(".tree-title", { hasText: /^Books$/ })).toBeVisible();
  // Click the name to rename it; the ↗ button opens it as a full page.
  await embedded.getByRole("button", { name: "Books", exact: true }).click();
  await page.getByLabel("Database name").fill("Reading list");
  await page.getByLabel("Database name").press("Enter");
  await expect(embedded.locator(".db-inline-title")).toContainText("Reading list");
  // /board view creates a database already shown as a board.
  await page.locator(".slate-prose > p").last().click();
  await page.keyboard.type("/board");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Database name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".db-compact .db-board")).toHaveCount(1);
  // Deleting the block moves the database to the Trash, with Undo.
  const block = page.locator(".slate-prose .react-renderer", {
    has: page.locator(".db-inline-title", { hasText: "Reading list" }),
  });
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 14);
  await page.getByRole("button", { name: "Block actions" }).click();
  await page.locator(".editor-context-menu").getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("“Reading list” moved to Trash")).toBeVisible();
  await expect(page.getByRole("complementary").locator(".tree-title", { hasText: /^Reading list$/ })).toHaveCount(0);
  await expect(page.locator(".pages-inside")).toHaveCount(0);
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".db-compact .db-inline-title", { hasText: "Reading list" })).toBeVisible();
  await expect(page.getByRole("complementary").locator(".tree-title", { hasText: /^Reading list$/ })).toBeVisible();
});
test("a linked database's views belong to the page it's linked in", async ({ page }) => {
  await createPage(page, "Dashboard");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/linked");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ten");
  await page.keyboard.press("Enter");
  const linked = page.locator(".db-compact");
  await expect(linked.locator(".db-linked-badge")).toHaveAttribute("title", /views here are only for this page/);
  // Change this block's view to a board.
  await linked.getByRole("button", { name: "View settings" }).click();
  await page.getByLabel("View layout").selectOption("board");
  await page.keyboard.press("Escape");
  await expect(linked.locator(".db-board")).toBeVisible();
  // The rows are shared…
  await expect(linked.getByText("Alex Morgan")).toBeVisible();
  // …but the original database still shows its own table.
  await page
    .getByRole("complementary")
    .locator(".tree-row", { hasText: /^Tenants/ })
    .locator(".tree-page")
    .click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Tenants");
  await expect(page.locator(".database-page .db-table")).toBeVisible();
  await expect(page.locator(".database-page .db-board")).toHaveCount(0);
  // And the linked block keeps its board after a reload.
  await page.goBack();
  await page.reload();
  await expect(page.locator(".db-compact .db-board")).toBeVisible();
});
test("a database dragged out of its page leaves a linked view with its own views", async ({ page }) => {
  await createPage(page, "Planning");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/database");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Books");
  await page.keyboard.press("Enter");
  const embedded = page.locator(".db-compact");
  await expect(embedded.locator(".db-linked-badge")).toHaveCount(0);
  // Drag "Books" out of "Planning" to the top level of the sidebar.
  const tree = page.locator('section[aria-label="Private"]');
  const row = (title: string) =>
    tree.locator(".tree-row", { has: page.locator(".tree-title", { hasText: new RegExp(`^${title}$`) }) });
  const a = (await row("Books").boundingBox())!;
  const b = (await row("Getting started").boundingBox())!;
  await page.mouse.move(a.x + 80, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 80, a.y + a.height / 2 + 12, { steps: 3 });
  await page.mouse.move(b.x + 80, b.y + b.height * 0.1, { steps: 8 });
  await page.mouse.move(b.x + 81, b.y + b.height * 0.1, { steps: 2 });
  await page.mouse.up();
  await expect(page.getByText("Moved to Private pages")).toBeVisible();
  // The block left in "Planning" is now a linked view with views of its own.
  await expect(embedded.locator(".db-linked-badge")).toHaveAttribute("title", /views here are only for this page/);
  await embedded.getByRole("button", { name: "View settings" }).click();
  await page.getByLabel("View layout").selectOption("board");
  await page.keyboard.press("Escape");
  await expect(embedded.locator(".db-board")).toBeVisible();
  await row("Books").locator(".tree-page").click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Books");
  await expect(page.locator(".database-page .db-table")).toBeVisible();
  await expect(page.locator(".database-page .db-board")).toHaveCount(0);
  // Undo puts it back in "Planning", which shows it as its own again (no extra link).
  await page.goBack();
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(embedded.locator(".db-linked-badge")).toHaveCount(0);
  await expect(page.locator(".db-compact")).toHaveCount(1);
  await expect(page.locator(".slate-prose .editor-page-reference")).toHaveCount(0);
});
test("a new page can start from a playbook template", async ({ page }) => {
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  const starter = page.getByLabel("Start this page");
  await starter.getByRole("button", { name: "Playbook", exact: true }).click();
  // One gallery: a blank playbook first, then templates grouped by what they're for.
  const gallery = page.locator(".procedure-gallery");
  await expect(page.getByRole("dialog", { name: "New playbook" })).toBeVisible();
  // Everyday templates first; the more technical ones are behind "More templates".
  await expect(gallery.locator(".procedure-group")).toHaveText(["Start fresh", "Home & property"]);
  await expect(gallery.getByRole("tab")).toHaveCount(0);
  await expect(gallery.getByRole("option", { name: /Blank checklist/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(gallery.getByRole("region", { name: "Monthly rent check preview" })).toContainText("Chase late rent");
  await gallery.getByRole("button", { name: /^More templates — support, operations, notes & automations/ }).click();
  await expect(gallery.locator(".procedure-group")).toHaveText([
    "Start fresh",
    "Home & property",
    "Support",
    "Operations",
    "Notes & automations",
  ]);
  await gallery.getByRole("option", { name: /Refund request/ }).click();
  await expect(gallery.getByRole("region", { name: "Refund request preview" })).toContainText("Check eligibility");
  await gallery.getByRole("button", { name: "Use template" }).click();
  await expect(gallery).toBeHidden();
  // The page takes the template's name and "when to use", and opens in the builder.
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Refund request");
  await expect(page.getByText("When to use: a customer asks for their money back on an order.")).toBeVisible();
  await expect(page.getByLabel("Section name").first()).toHaveValue("Check eligibility");
  await expect(starter).toBeHidden();
  // Undo puts the page back the way it was.
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(starter).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("");
  // An operations template keeps a title you already typed, and dates its review.
  await page.getByLabel("Page title", { exact: true }).fill("Ship v2");
  await starter.getByRole("button", { name: "Playbook", exact: true }).click();
  await openTemplate(page, /Deploy a release/);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Ship v2");
  await expect(page.getByLabel("Section name").last()).toHaveValue("Roll back");
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  const details = page.getByRole("region", { name: "Details" });
  await expect(details.getByLabel("Last reviewed")).toHaveValue(today);
  await expect(details.getByLabel("Owner")).toHaveValue("Release manager");
  await page.reload();
  await expect(page.getByLabel("Section name").last()).toHaveValue("Roll back");
});
test("/runbook in a page creates a runbook page and links it there", async ({ page }) => {
  await page
    .getByRole("complementary")
    .locator(".tree-title", { hasText: /^Getting started$/ })
    .click();
  const editor = page.getByLabel("Page content", { exact: true });
  // On the empty line at the end of the page.
  await page.locator(".slate-prose > p").last().click();
  await page.keyboard.type("/runbook");
  await page.keyboard.press("Enter");
  // "/runbook" still finds it: there's one kind of playbook now.
  const gallery = page.getByRole("dialog", { name: "New playbook" });
  await openTemplate(page, /Deploy a release/);
  await page.keyboard.press("Enter");
  await expect(gallery).toBeHidden();
  // The page keeps its own content; the runbook is a page of its own, linked here.
  await expect(editor.getByRole("heading", { name: "Make yourself at home" })).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  const link = editor.locator(".editor-page-reference", { hasText: "Deploy a release" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Deploy a release");
  await expect(page.getByLabel("Section name").first()).toHaveValue("Before you start");
  // Closing the gallery without choosing creates nothing.
  await page.goBack();
  await page.locator(".slate-prose > p").last().click();
  await page.keyboard.type("/playbook");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New playbook" })).toBeHidden();
  await expect(page.locator(".editor-page-reference")).toHaveCount(1);
});
test("a playbook runs step by step, branches on its inputs and is saved as a run", async ({ page }) => {
  await startFromTemplate(page, "Playbook", /Refund request/);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Run Refund request" });
  // Required inputs are checked before starting.
  await form.getByRole("button", { name: "Start run" }).click();
  await expect(form.getByText("Order number is required")).toBeVisible();
  await form.getByLabel("Order number").fill("A-1042");
  await form.getByLabel("Order total").fill("$84.00");
  await form.getByLabel("Days since delivery").fill("45");
  await form.getByLabel("Reason").selectOption("Damaged");
  await form.getByLabel("Days since delivery").press("Enter");
  const run = page.locator(".run-surface");
  await expect(run.locator(".run-input-chip", { hasText: "A-1042" })).toBeVisible();
  // 45 days is past the window: the If step says why and where it goes.
  await expect(run.locator(".run-decision")).toContainText("“is less than 31” is false");
  await expect(run.locator(".run-decision")).toContainText("Offer store credit");
  await page.keyboard.press("Enter");
  // Send: values are filled in.
  await expect(run.locator(".run-card-text")).toHaveText(
    "Order A-1042 is outside our 30-day refund window, but I can offer $84.00 in store credit instead.",
  );
  await page.keyboard.press("Enter");
  // Ask (yes / no), then Back changes the answer.
  await run.getByRole("button", { name: "No", exact: true }).click();
  await expect(run.locator(".run-decision")).toContainText("Escalate");
  await run.getByRole("button", { name: "Back" }).click();
  await run.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(run.locator(".run-decision")).toContainText("the next step");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(run.getByRole("button", { name: "Finish run" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(run.getByRole("heading", { name: "Run complete" })).toBeVisible();
  // Steps on the path not taken are marked skipped in the outline.
  await expect(run.locator(".run-outline li.is-skipped")).toHaveCount(3);
  await run.getByRole("button", { name: "Done" }).click();
  await expect(run).toBeHidden();
  // The run is a record in the playbook's Runs database.
  await page.getByRole("button", { name: "1 run" }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Runs");
  const row = page.getByRole("row", { name: /A-1042/ });
  await expect(row).toContainText("Done");
  await expect(row).toContainText("Store credit issued");
  await expect(page.getByRole("columnheader", { name: /Progress/ })).toHaveCount(0);
});
test("a run can be paused, picked up after a reload, and started from a run link", async ({ page }) => {
  await startFromTemplate(page, "Runbook", /Deploy a release/);
  const url = page.url();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const start = page.getByRole("dialog", { name: /^Run / });
  await start.getByLabel("Version").fill("2.4.0");
  await start.getByRole("button", { name: "Start run" }).click();
  const run = page.locator(".run-surface");
  await run.getByRole("button", { name: "Passed" }).click();
  await expect(run.locator(".run-card-text")).toContainText("deploying 2.4.0 to Production");
  await page.keyboard.press("Escape");
  await expect(run).toBeHidden();
  await page.reload();
  const resume = page.getByRole("button", { name: /Resume 2\.4\.0 .* step 2 of/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(run.locator(".run-card-text")).toContainText("deploying 2.4.0 to Production");
  await page.keyboard.press("Enter");
  // A failed check goes to Roll back.
  await run.getByRole("button", { name: "Failed" }).click();
  await expect(run.locator(".run-card-text")).toContainText("Redeploy the previous version");
  await run.getByRole("button", { name: "Stop" }).click();
  await expect(run.getByRole("heading", { name: "Run stopped" })).toBeVisible();
  await page.keyboard.press("Escape");
  // A run link opens the form already filled in, and only once.
  await page.goto(`${url}?run=1&version=3.0.0&environment=Staging`);
  const form = page.getByRole("dialog", { name: /^Run / });
  await expect(form.getByLabel("Version")).toHaveValue("3.0.0");
  await expect(form.getByLabel("Environment")).toHaveValue("Staging");
  await expect(page).toHaveURL(url);
});
test("a playbook is built from inputs, sections and steps", async ({ page }) => {
  await startFromTemplate(page, "Playbook", /Blank checklist/);
  // A plain checklist has no inputs panel until you ask for one.
  const inputs = page.getByRole("region", { name: "Inputs" });
  await expect(inputs).toHaveCount(0);
  await page.getByRole("button", { name: "Ask for details before starting" }).click();
  await inputs.getByRole("button", { name: "Add an input" }).click();
  await inputs.getByLabel("Input name").last().fill("Tenant name");
  // A new section, named in its card.
  await page.getByRole("button", { name: "Add section" }).click();
  const section = page.locator(".pb-section").last();
  await expect(section.getByLabel("Section name")).toBeFocused();
  await page.keyboard.type("Remind");
  await expect(page.locator(".pb-outline-title").last()).toHaveText("Remind");
  // Its first step: Say, with a value inserted by name.
  const say = section.locator(".pb-step").first();
  await say.locator(".pb-step-text").click();
  await page.keyboard.type("Send a reminder to ");
  await say.getByRole("button", { name: "Insert a value" }).click();
  await page.getByRole("menuitem", { name: "Tenant name" }).click();
  await expect(say.locator(".var-chip")).toHaveText("Tenant name");
  // Enter adds the next step; then pick an Ask step and remember the answer.
  await page.keyboard.press("Enter");
  await expect(section.locator(".pb-step")).toHaveCount(2);
  await section.locator(".pb-step").nth(1).getByLabel("Step type").selectOption("ask");
  await page.keyboard.type("Did they pay?");
  await section.getByLabel("Remember the answer as").fill("Paid");
  await section.locator(".pb-step").nth(1).getByLabel("Answer type").selectOption("yesno");
  // A decision picks the value by name.
  await section.getByRole("button", { name: "Add step" }).click();
  await page.getByRole("menuitem", { name: /Decide/ }).click();
  const decide = section.locator(".pb-step.is-if");
  await decide.getByLabel("Value to check").selectOption({ label: "Paid" });
  await decide.getByLabel("Value to compare").fill("No");
  // Renaming the input renames it everywhere it's used.
  await inputs.getByLabel("Input name").last().fill("Renter");
  await expect(say.locator(".var-chip")).toHaveText("Renter");
  await section.getByLabel("Remember the answer as").fill("Has paid");
  await expect(decide.getByLabel("Value to check")).toHaveValue("has_paid");
  await expect(section.locator(".pb-count")).toHaveText("3 steps");
  // Saved: it's all there after a reload, and it runs.
  await page.reload();
  const again = page.locator(".pb-section").last();
  await expect(again.getByLabel("Section name")).toHaveValue("Remind");
  await expect(again.locator(".pb-step").first().locator(".var-chip")).toHaveText("Renter");
  await expect(page.locator(".run-bar-meta")).toContainText("steps");
});
test("an API step calls an endpoint, saves the response and branches on it", async ({ page }) => {
  let calls = 0;
  let lastAuth = "";
  await mockApi(page, "https://api.example.test/", (request) => {
    calls++;
    lastAuth = request.headers["authorization"] || "";
    if (request.url.endsWith("/orders/BAD")) return { status: 404, body: '{"error":"not found"}' };
    return { status: 200, body: JSON.stringify({ id: "A-7", status: "shipped", carrier: { name: "UPS" } }) };
  });
  const node = (value: object) => `:::slate-node ${JSON.stringify(value)}`;
  const source = [
    node({ type: "procedureParams", attrs: { params: [{ name: "order_number", type: "text", required: true }] } }),
    "## Look up",
    node({
      type: "procedureStep",
      attrs: {
        step: "api",
        method: "GET",
        url: "https://api.example.test/orders/{{order_number}}",
        headers: "Authorization: Bearer sk_test_abcdef123456",
        variable: "order",
        else: "Not found",
      },
      content: [{ type: "text", text: "Look up the order" }],
    }),
    node({
      type: "procedureStep",
      attrs: { step: "if", variable: "order.status", op: "is", value: "shipped", then: "Shipped", else: "@end" },
    }),
    "## Shipped",
    node({
      type: "procedureStep",
      attrs: { step: "end" },
      content: [{ type: "text", text: "Shipped by {{order.carrier.name}}" }],
    }),
    "## Not found",
    node({
      type: "procedureStep",
      attrs: { step: "end" },
      content: [{ type: "text", text: "No order {{order_number}}" }],
    }),
  ].join("\n\n");
  await createPage(page, "Order lookup");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.locator(".markdown-source-editor .cm-content").click();
  await page.keyboard.insertText(source);
  // Once it has steps, the page is a playbook: it goes back to the editor by itself.
  await expect(page.locator(".md-editor")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Editor mode" })).toHaveCount(0);
  // The step's settings show in the editor.
  await expect(page.getByLabel("URL", { exact: true })).toHaveValue("https://api.example.test/orders/{{order_number}}");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Run Order lookup" });
  await form.getByLabel("Order number").fill("A-7");
  await form.getByRole("button", { name: "Start run" }).click();
  const run = page.locator(".run-surface");
  // The request is shown before anything is sent, with the secret masked.
  await expect(run.locator(".run-request-line")).toContainText("GET");
  await expect(run.locator(".run-request-line")).toContainText("https://api.example.test/orders/A-7");
  await expect(run.locator(".run-request-headers")).toContainText("Bearer ••••3456");
  await expect(run.locator(".run-request-headers")).not.toContainText("sk_test");
  expect(calls).toBe(0);
  await page.keyboard.press("Enter");
  await expect(run.locator(".run-response")).toContainText("200 OK");
  await expect(run.locator(".run-response")).toContainText('"carrier"');
  expect(lastAuth).toBe("Bearer sk_test_abcdef123456");
  await page.keyboard.press("Enter");
  await expect(run.locator(".run-decision")).toContainText("Order → status is “shipped”");
  await page.keyboard.press("Enter");
  await expect(run.locator(".run-card-text")).toHaveText("Shipped by UPS");
  await page.keyboard.press("Enter");
  await expect(run.getByRole("heading", { name: "Run complete" })).toBeVisible();
  // A failing request offers Retry, or continues down the failure path.
  await run.getByRole("button", { name: "Run again" }).click();
  await form.getByLabel("Order number").fill("BAD");
  await form.getByRole("button", { name: "Start run" }).click();
  await page.keyboard.press("Enter");
  await expect(run.locator(".run-response.is-failed")).toContainText("404");
  await run.getByRole("button", { name: "Retry" }).click();
  await expect(run.locator(".run-response.is-failed")).toContainText("404");
  await run.getByRole("button", { name: "Continue to “Not found”" }).click();
  await expect(run.locator(".run-card-text")).toHaveText("No order BAD");
});
test("sections are cards: fold, rename with links following, reorder, run from here", async ({ page }) => {
  await startFromTemplate(page, "Runbook", /Restore from backup/);
  const section = (name: string) => page.locator(".pb-section", { has: page.locator(`input[value="${name}"]`) });
  await expect(section("Restore").locator(".pb-count")).toHaveText("4 steps");
  // Fold a section's steps away and back.
  await section("Restore").locator(".pb-count").click();
  await expect(section("Restore").locator(".pb-step")).toHaveCount(0);
  await section("Restore").locator(".pb-count").click();
  await expect(section("Restore").locator(".pb-step")).toHaveCount(4);
  // Renaming a section updates the steps that jump to it.
  const failTarget = section("Restore").locator(".pb-step").nth(2).getByLabel("If it fails");
  await expect(failTarget).toHaveValue("Roll back");
  await section("Roll back").getByLabel("Section name").fill("Undo the restore");
  await expect(failTarget).toHaveValue("Undo the restore");
  await expect(failTarget.locator("option:checked")).toHaveText("Jump to “Undo the restore”");
  // Sections can be moved; the numbers follow.
  await section("Verify")
    .getByRole("button", { name: /Section \d options/ })
    .click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(page.locator(".pb-outline-title")).toHaveText([
    "Before you start",
    "Verify",
    "Restore",
    "Undo the restore",
  ]);
  // Run from here starts the run at that section.
  await section("Undo the restore")
    .getByRole("button", { name: /Section \d options/ })
    .click();
  await page.getByRole("menuitem", { name: "Run from here" }).click();
  const form = page.getByRole("dialog", { name: /^Run / });
  await expect(form).toContainText("Starts at “Undo the restore”");
  await form.getByLabel("Database").fill("orders");
  await form.getByLabel("Restore point").fill("2026-11-01");
  await form.getByRole("button", { name: "Start run" }).click();
  await expect(page.locator(".run-card-text")).toHaveText(
    "Point the app back at the original orders and tell the team.",
  );
});
test("steps can be reordered, moved between sections, duplicated and deleted with undo", async ({ page }) => {
  await startFromTemplate(page, "Runbook", /Restore from backup/);
  const section = (name: string) => page.locator(".pb-section", { has: page.locator(`input[value="${name}"]`) });
  const texts = (name: string) => section(name).locator(".pb-step-text");
  await expect(texts("Restore").first()).toContainText("Find the newest backup");
  // Move down from the step's menu.
  await section("Restore").locator(".pb-step").first().getByRole("button", { name: "Step 2.1 options" }).click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect(texts("Restore").nth(1)).toContainText("Find the newest backup");
  // Move to another section.
  await section("Restore").locator(".pb-step").first().getByRole("button", { name: "Step 2.1 options" }).click();
  await page.getByRole("menuitem", { name: "Move to “Verify”" }).click();
  await expect(section("Restore").locator(".pb-step")).toHaveCount(3);
  await expect(section("Verify").locator(".pb-step")).toHaveCount(3);
  // Drag a step by its handle to the top of its section.
  await section("Verify").locator(".pb-step").last().hover();
  const handle = section("Verify")
    .locator(".pb-step")
    .last()
    .getByRole("button", { name: /Move step/ });
  await expect(handle).toBeVisible();
  const target = section("Verify").locator(".pb-step").first();
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y - 10, { steps: 4 });
  await page.mouse.move(to.x + 30, to.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect(texts("Verify").first()).toContainText("Restore it to a separate copy");
  // Duplicate, then delete with Undo.
  await section("Roll back")
    .locator(".pb-step")
    .first()
    .getByRole("button", { name: /options/ })
    .click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(section("Roll back").locator(".pb-step")).toHaveCount(3);
  await section("Roll back")
    .locator(".pb-step")
    .first()
    .getByRole("button", { name: /options/ })
    .click();
  await page.getByRole("menuitem", { name: "Delete step" }).click();
  await expect(section("Roll back").locator(".pb-step")).toHaveCount(2);
  await page.locator("[data-sonner-toast]", { hasText: "Deleted step" }).getByRole("button", { name: "Undo" }).click();
  await expect(section("Roll back").locator(".pb-step")).toHaveCount(3);
});
test("values in steps are chips that behave like one character", async ({ page }) => {
  await startFromTemplate(page, "Playbook", /Blank checklist/);
  // A new step at the end of the first section.
  const first = page.locator(".pb-section").first();
  await first.getByRole("button", { name: "Add step" }).click();
  await page.getByRole("menuitem", { name: /Say/ }).click();
  // (It goes in before the section's closing Finish step.)
  const step = first.locator(".pb-step.is-send");
  const text = step.locator(".pb-step-text");
  await expect(text).toBeFocused();
  // Typing {{name}} becomes a chip, and typing continues after it.
  await page.keyboard.type("Hi {{customer_name}}");
  await expect(step.locator(".var-chip")).toHaveText("Customer name");
  await page.keyboard.type(" there");
  await expect(text).toHaveText("Hi Customer name there");
  // Home / End jump to the ends of the line, past the chip.
  await page.keyboard.press("Home");
  await page.keyboard.type(">");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(text).toHaveText(">Hi Customer name there!");
  // Arrow keys step over the chip as one character.
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("·");
  await expect(text).toHaveText(">Hi ·Customer name there!");
  // Backspace right after a chip removes it whole.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await expect(step.locator(".var-chip")).toHaveCount(0);
  await expect(text).toHaveText(">Hi · there!");
  // A chip at the very end: End then Backspace removes it.
  await page.keyboard.press("End");
  await page.keyboard.type(" {{order_total}}");
  await expect(step.locator(".var-chip")).toHaveText("Order total");
  await page.keyboard.press("Home");
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(step.locator(".var-chip")).toHaveCount(0);
  await expect(text).toHaveText(">Hi · there! ");
  // Clicking the right half of a chip puts the caret after it.
  await page.keyboard.type("{{order_total}}");
  const chip = step.locator(".var-chip");
  const box = (await chip.boundingBox())!;
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await page.keyboard.type("?");
  await expect(text).toHaveText(">Hi · there! Order total?");
});
test("playbooks are edited on the page; their Markdown is one menu away", async ({ page }) => {
  // An ordinary page keeps the Interactive / Markdown switch.
  await createPage(page, "Plain notes");
  await expect(page.getByRole("group", { name: "Editor mode" })).toBeVisible();
  await startFromTemplate(page, "Runbook", /Deploy a release/);
  await expect(page.getByRole("group", { name: "Editor mode" })).toHaveCount(0);
  // View as Markdown shows the source, read-only.
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("menuitem", { name: "View as Markdown" }).click();
  const dialog = page.getByRole("dialog", { name: "Markdown source" });
  await expect(dialog.getByLabel("Markdown source")).toContainText('"type":"procedureStep"');
  // Edit anyway opens the source with a warning; Back to the page returns to blocks.
  await dialog.getByRole("button", { name: "Edit anyway" }).click();
  await expect(page.locator(".md-editor")).toBeVisible();
  await expect(page.locator(".source-warning")).toContainText("editing this playbook");
  await page.getByRole("button", { name: "Back to the page" }).click();
  await expect(page.locator(".md-editor")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Editor mode" })).toHaveCount(0);
  await expect(page.locator(".proc-step").first()).toBeVisible();
});
test("ordinary pages don't offer playbook steps in the / menu", async ({ page }) => {
  await createPage(page, "Notes");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await expect(page.getByLabel("Page content", { exact: true })).toBeFocused();
  await page.keyboard.type("/say");
  await expect(page.locator(".slash-command-menu")).not.toContainText("Say something");
  await page.keyboard.press("Escape");
  await page.keyboard.type(" /playbook");
  await expect(page.locator(".slash-command-menu")).toContainText("A new playbook page from a template, linked here");
});
test("the builder checks the playbook and says what to fix", async ({ page }) => {
  await startFromTemplate(page, "Playbook", /Refund request/);
  const outline = page.getByRole("region", { name: "Outline" });
  await expect(outline).toContainText("Ready to run");
  // Deleting a section that steps jump to: both are flagged, and counted.
  const escalate = page.locator(".pb-section", { has: page.locator('input[value="Escalate"]') });
  await escalate.getByRole("button", { name: /Section \d options/ }).click();
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  await expect(outline.getByRole("button", { name: "2 to fix" })).toBeVisible();
  await expect(
    page.locator(".pb-issues .is-warning", { hasText: "It jumps to “Escalate”, which isn't a section any more." }),
  ).toHaveCount(2);
  await expect(page.locator(".pb-step.has-warning")).toHaveCount(2);
  // Undo brings it back, and everything is fine again.
  await page.locator("[data-sonner-toast]", { hasText: "Deleted" }).getByRole("button", { name: "Undo" }).click();
  await expect(outline).toContainText("Ready to run");
  // A new decision says what it still needs.
  const first = page.locator(".pb-section").first();
  await first.getByRole("button", { name: "Add step" }).click();
  await page.getByRole("menuitem", { name: /Decide/ }).click();
  const decide = first.locator(".pb-step").last();
  await expect(decide.locator(".pb-issues")).toContainText("Choose which value to check.");
  await decide.getByLabel("Value to check").selectOption({ label: "Reason" });
  await decide.getByLabel("Value to compare").fill("Damaged");
  await expect(decide.locator(".pb-issues")).toContainText("Both answers go the same way");
  await expect(decide.locator(".pb-issues .is-warning")).toHaveCount(0);
});
test("the builder scrolls as one page, with inputs as one-line summaries", async ({ page }) => {
  await startFromTemplate(page, "Playbook", /Refund request/);
  const inputs = page.getByRole("region", { name: "Inputs" });
  // Inputs read as summaries; clicking one opens it, Done closes it.
  await expect(inputs.getByRole("button", { name: "Edit Order total" })).toContainText("Text · Required");
  await inputs.getByRole("button", { name: "Edit Order total" }).click();
  await expect(inputs.getByLabel("Input name")).toHaveValue("Order total");
  await inputs.getByRole("button", { name: "Done" }).click();
  await expect(inputs.getByLabel("Input name")).toHaveCount(0);
  // No box inside the builder scrolls on its own; the outline stays in view.
  const scrollers = await page.evaluate(
    () =>
      [...document.querySelectorAll(".pb *")].filter((el) => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
      }).length,
  );
  expect(scrollers).toBe(0);
  await page.evaluate(() => (document.querySelector(".page-scroll")!.scrollTop = 1500));
  await expect(page.getByRole("region", { name: "Outline" })).toBeInViewport();
});
test("automation templates call other apps and keep secrets out of run history", async ({ page }) => {
  // Automations have their own group in the gallery.
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByLabel("Start this page").getByRole("button", { name: "Playbook", exact: true }).click();
  const gallery = page.locator(".procedure-gallery");
  await gallery.getByRole("button", { name: /^More templates/ }).click();
  await expect(gallery.locator(".procedure-group").last()).toHaveText("Notes & automations");
  // Daily standup: answers are posted to the team webhook, and kept as the run's note.
  let posted = "";
  await mockApi(page, "https://hooks.example.test/", (request) => {
    posted = request.body || "";
    return { status: 200, body: "ok" };
  });
  await gallery.getByRole("option", { name: /Daily standup note/ }).click();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const form = page.getByRole("dialog", { name: /^Run / });
  await form.getByLabel("Your name").fill("Sam");
  await form.getByLabel("Team chat webhook (optional)").fill("https://hooks.example.test/T1/B2");
  await form.getByRole("button", { name: "Start run" }).click();
  const run = page.locator(".run-surface");
  for (const answer of ["Fixed the invoice bug", "Release notes", "None"]) {
    await run.getByLabel("Answer").fill(answer);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Enter"); // the decision: there's a webhook, so share
  await expect(run.locator(".run-request-line")).toContainText("https://hooks.example.test/T1/B2");
  await page.keyboard.press("Enter");
  await expect(run.locator(".run-response")).toContainText("200 OK");
  expect(JSON.parse(posted)).toEqual({
    text: "Sam: yesterday Fixed the invoice bug · today Release notes · blockers None",
  });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(run.getByRole("heading", { name: "Run complete" })).toBeVisible();
  await run.getByRole("button", { name: "Done" }).click();
  // Meeting notes: the API token is a secret — hidden in the form, never saved or linked.
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByLabel("Start this page").getByRole("button", { name: "Playbook", exact: true }).click();
  await gallery.getByRole("option", { name: /Meeting notes to tasks/ }).click();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await form.getByLabel("Meeting").fill("Planning");
  const token = form.getByLabel("API token (optional)");
  await expect(token).toHaveAttribute("type", "password");
  await token.fill("sk_live_very_secret");
  await form.getByRole("button", { name: "Copy run link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  if (link) expect(link).not.toContain("sk_live_very_secret");
  await form.getByRole("button", { name: "Start run" }).click();
  await expect(run.locator(".run-inputs")).not.toContainText("sk_live");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "1 run" }).click();
  await expect(page.getByRole("row", { name: /Planning/ })).toBeVisible();
  await expect(page.locator(".database-view")).not.toContainText("sk_live_very_secret");
});
test("a playbook opened directly (hard reload) has its styles", async ({ page }) => {
  await startFromTemplate(page, "Runbook", /Check a site is up/);
  const url = page.url();
  // Let the new playbook reach Supabase before leaving.
  await expect(page.locator(".save-status")).toHaveText("Saved");
  // A fresh load of the playbook's address, without passing through a normal page.
  await page.goto("about:blank");
  await page.goto(url);
  const badge = page.locator(".pb-step .proc-step-badge select").first();
  await expect(badge).toBeAttached();
  // The type menu sits invisibly over its short label, and steps have their card look.
  await expect.poll(() => badge.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  const radius = await page
    .locator(".pb-step")
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).not.toBe("0px");
});
test("settings explain AI agent access and offer agent keys", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const agents = page.getByRole("region", { name: "AI agents" });
  await expect(agents).toContainText("Let an AI agent use this workspace");
  // New keys are read-only unless you choose otherwise.
  await expect(agents.getByRole("radio", { name: /Read only/ })).toBeChecked();
  await expect(agents).toContainText("nothing is ever deleted for good");
  await expect(agents.getByRole("radio")).toHaveCount(3);
  await expect(agents.getByRole("button", { name: "Create key" })).toBeVisible();
  await expect(agents).toContainText("No apps or agent keys for this workspace yet.");
  await expect(agents).toContainText("A key opens only this workspace.");
  await expect(agents.getByRole("link", { name: /Setup guide/ })).toHaveAttribute("href", "/docs/mcp");
  // About: where to ask about the account and its data.
  await expect(page.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact?topic=delete");
  await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
});
test("run-request and MCP turn away callers over their limit", async ({ page, playwright, baseURL }) => {
  // The test server allows 5 a minute for each (see playwright.config.ts); production
  // uses Cloudflare's limits from wrangler.jsonc. Empty bodies are counted, then refused
  // with 400, so nothing is sent anywhere.
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await page.request.post("/api/run-request", { data: {} })).status());
  expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
  expect(statuses[5]).toBe(429);
  const refused = await page.request.post("/api/run-request", { data: {} });
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await refused.json()).error).toContain("at most 5 requests a minute");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("region", { name: "AI agents" }).getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator(".agent-created code").first().textContent())!.trim();
  const agent = await playwright.request.newContext({ baseURL });
  const ping = () =>
    agent.post("/api/mcp", {
      headers: { Authorization: `Bearer ${key}` },
      data: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
  for (let i = 0; i < 5; i++) expect((await ping()).status()).toBe(200);
  const tooMany = await ping();
  expect(tooMany.status()).toBe(429);
  expect(tooMany.headers()["retry-after"]).toBeTruthy();
  expect((await tooMany.json()).error.message).toContain("Too many requests for this key");
  await agent.dispose();
});
test("an agent key reads the workspace over MCP without a session", async ({ page, playwright, baseURL }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const agents = page.getByRole("region", { name: "AI agents" });
  await agents.getByRole("button", { name: "Create key" }).click();
  const key = (await agents.locator(".agent-created code").first().textContent())!.trim();
  expect(key).toMatch(/^slate_/);
  // A separate client with no cookies: only the key identifies the workspace.
  const agent = await playwright.request.newContext({ baseURL });
  const rpc = (body: object, token = key) =>
    agent.post("/api/mcp", { headers: { Authorization: `Bearer ${token}` }, data: { jsonrpc: "2.0", id: 1, ...body } });
  const hello = await rpc({
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
  });
  expect(hello.status()).toBe(200);
  expect((await hello.json()).result.serverInfo.name).toBe("slate");
  const search = await rpc({
    method: "tools/call",
    params: { name: "search_workspace", arguments: { query: "Rent Ledger" } },
  });
  expect(search.status()).toBe(200);
  expect(JSON.stringify(await search.json())).toContain("Rent Ledger");
  // A made-up key is turned away by the endpoint itself.
  const wrong = await rpc({ method: "initialize", params: {} }, `slate_${"A".repeat(43)}`);
  expect(wrong.status()).toBe(401);
  expect((await wrong.json()).error.message).toContain("not valid");
  await agent.dispose();
});
test("checklists first: a plain list, advanced steps on request, and to-do lists that become runnable", async ({
  page,
}) => {
  await startFromTemplate(page, "Playbook", /Blank checklist/);
  // A blank checklist is just steps: no inputs or guidelines panels, they're offered instead.
  await expect(page.getByRole("region", { name: "Inputs" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guidelines" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask for details before starting" })).toBeVisible();
  await expect(page.locator(".pb-step.is-check")).toHaveCount(3);
  // With no values to insert, steps have no Value button.
  await expect(page.locator(".pb-step").first().getByRole("button", { name: "Insert a value" })).toHaveCount(0);
  // Everyday steps first; decisions, calls and Finish under More.
  await page.locator(".pb-section").first().getByRole("button", { name: "Add step" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([/^Check/, /^Ask/, /^Say/, /^Decide/, /^Call/, /^Finish/]);
  await expect(menu).toContainText("More");
  await menu.getByRole("menuitem", { name: /^Check/ }).click();
  // It goes in before the closing Finish step (a step after Finish would never run).
  const steps = page.locator(".pb-section").first().locator(".pb-step");
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(3).locator(".pb-step-text")).toBeFocused();
  await expect(steps.last()).toHaveClass(/is-end/);
  await page.keyboard.type("Lock the door");
  // Enter keeps the list going with another of the same.
  await page.keyboard.press("Enter");
  await expect(page.locator(".pb-step.is-check")).toHaveCount(5);
  await expect(steps.nth(3).locator(".pb-step-text")).toHaveText("Lock the door");
  await expect(steps.last()).toHaveClass(/is-end/);
  // Run it once: the run bar remembers.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator(".run-surface").getByRole("button", { name: "Stop" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /1 run · last just now/ })).toBeVisible();
  // A to-do list on an ordinary page becomes a runnable checklist from its block menu.
  await createPage(page, "Weekend jobs");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("[] Mow the lawn");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Fix the gate");
  const list = page.locator(".slate-prose ul[data-type='taskList']");
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 12);
  await page.getByRole("button", { name: "Block actions" }).click();
  await page.getByRole("menuitem", { name: "Make a runnable checklist" }).click();
  // The list stays; a checklist page is linked below it.
  await expect(list).toContainText("Fix the gate");
  const link = page.locator(".editor-page-reference", { hasText: "Weekend jobs checklist" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator(".pb-step-text")).toHaveText(["Mow the lawn", "Fix the gate", "All done"]);
  await expect(page.getByRole("region", { name: "Outline" })).toContainText("Ready to run");
});
test("playbooks: one place to find and run them all, and Run from the sidebar", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  // No playbooks yet: no entry.
  await expect(sidebar.getByRole("button", { name: /^Playbooks/ })).toHaveCount(0);
  await startFromTemplate(page, "Playbook", /Monthly rent check/);
  await startFromTemplate(page, "Playbook", /Tenant move-in/);
  await expect(sidebar.getByRole("button", { name: /^Playbooks/ })).toContainText("2");
  // Run one from the sidebar without opening it.
  await sidebar.getByRole("button", { name: "Getting started", exact: true }).click();
  const row = sidebar.locator(".tree-row", { hasText: "Monthly rent check" });
  await row.hover();
  await row.getByRole("button", { name: "Run Monthly rent check" }).click();
  const form = page.getByRole("dialog", { name: "Run Monthly rent check" });
  await form.getByRole("button", { name: "Start run" }).click();
  const run = page.locator(".run-surface");
  await run.getByRole("button", { name: "Passed" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  // The Playbooks view lists both, with last run and the run in progress.
  await sidebar.getByRole("button", { name: /^Playbooks/ }).click();
  await expect(page).toHaveURL(/\/p\/playbooks$/);
  const list = page.getByRole("list", { name: "Playbooks" });
  await expect(list.locator(".playbook-row")).toHaveCount(2);
  const rent = list.locator(".playbook-row", { hasText: "Monthly rent check" });
  await expect(rent).toContainText("1 run, last just now");
  await expect(rent).toContainText("At the start of each month");
  await expect(list.locator(".playbook-row", { hasText: "Tenant move-in" })).toContainText("never run");
  // Resume picks the run up where it was.
  await rent.getByRole("button", { name: "Resume" }).click();
  await expect(run.locator(".run-card-kind")).toContainText("Step 2 of");
  await page.keyboard.press("Escape");
  // Open goes to the playbook; Back returns here.
  await rent.getByRole("button", { name: /^Monthly rent check/ }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Monthly rent check");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Playbooks", level: 1 })).toBeVisible();
});
test("collapse all pages in the sidebar at once", async ({ page }) => {
  const tree = page.locator('section[aria-label="Private"]');
  // The hub is open (its pages show); Collapse all folds everything.
  await expect(tree.locator(".tree-title", { hasText: /^Tenant Rent Log$/ })).toBeVisible();
  await tree.locator(".section-heading").hover();
  await tree.getByRole("button", { name: "Collapse all pages" }).click();
  await expect(tree.locator(".tree-title", { hasText: /^Tenant Rent Log$/ })).toHaveCount(0);
  await expect(tree.locator(".tree-title", { hasText: /^Rental Property Finance Hub$/ })).toBeVisible();
  // With nothing open, there's nothing to collapse: the button goes away.
  await expect(tree.getByRole("button", { name: "Collapse all pages" })).toHaveCount(0);
  // Expanding again brings it back.
  await tree.locator(".tree-row", { hasText: "Rental Property Finance Hub" }).hover();
  await tree.getByRole("button", { name: "Expand Rental Property Finance Hub" }).click();
  await expect(tree.locator(".tree-title", { hasText: /^Tenant Rent Log$/ })).toBeVisible();
  await tree.locator(".section-heading").hover();
  await expect(tree.getByRole("button", { name: "Collapse all pages" })).toBeVisible();
});
test("ticking a to-do doesn't move focus into the page", async ({ page }) => {
  await createPage(page, "To-dos");
  const editor = page.getByLabel("Page content", { exact: true });
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("[] Water the plants");
  await page.getByLabel("Page title", { exact: true }).click();
  const box = editor.locator('ul[data-type="taskList"] > li input[type="checkbox"]');
  await box.click();
  await expect(box).toBeChecked();
  // Focus stays where it was (the title), so nothing starts editing the to-do's text.
  await expect(page.getByLabel("Page title", { exact: true })).toBeFocused();
  await page.reload();
  await expect(page.locator('ul[data-type="taskList"] > li input[type="checkbox"]')).toBeChecked();
});
test("shortcuts are shown the way each computer names them", async ({ page }) => {
  for (const [platform, search, toggle, back] of [
    ["MacIntel", "⌘K", "⌘\\", "⌘[ · ⌘]"],
    ["Win32", "Ctrl+K", "Ctrl+\\", "Ctrl+[ · Ctrl+]"],
  ] as const) {
    await page.addInitScript((name) => {
      Object.defineProperty(navigator, "platform", { get: () => name, configurable: true });
      Object.defineProperty(navigator, "userAgentData", { get: () => undefined, configurable: true });
    }, platform);
    await page.reload();
    await expect(page.getByLabel("Page title", { exact: true })).toBeVisible();
    const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
    await expect(sidebar.locator(".sidebar-search kbd")).toHaveText(search);
    await page.getByRole("button", { name: "Help and keyboard shortcuts" }).click();
    const help = page.locator(".shortcuts");
    await expect(help).toContainText("A few helpful shortcuts");
    await expect(help.locator("div", { hasText: "Find anything" }).locator("kbd")).toHaveText(search);
    await expect(help.locator("div", { hasText: "Toggle sidebar" }).locator("kbd")).toHaveText(toggle);
    await expect(help.locator("div", { hasText: "Back / forward" }).locator("kbd")).toHaveText(back.split(" · "));
    await page.keyboard.press("Escape");
  }
});
test("an agent with a 'Read and create' key adds a page, a database and a playbook", async ({
  page,
  playwright,
  baseURL,
}) => {
  // Two keys: one read-only (the default), one that may create.
  const makeKey = async (name: string, scope?: "Read and create") => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const agents = page.getByRole("region", { name: "AI agents" });
    await agents.getByRole("textbox").fill(name);
    if (scope) await agents.getByRole("radio", { name: new RegExp(scope) }).check();
    await agents.getByRole("button", { name: "Create key" }).click();
    const key = (await agents.locator(".agent-created code").first().textContent())!.trim();
    await expect(agents.locator(".agent-keys li", { hasText: name })).toContainText(scope ?? "Read only");
    await page.keyboard.press("Escape");
    return key;
  };
  const reader = await makeKey("Reader");
  const maker = await makeKey("Maker", "Read and create");
  const agent = await playwright.request.newContext({ baseURL });
  const call = async (key: string, method: string, params: object = {}) =>
    (
      await (
        await agent.post("/api/mcp", {
          headers: { Authorization: `Bearer ${key}` },
          data: { jsonrpc: "2.0", id: 1, method, params },
        })
      ).json()
    ).result;
  const tools = async (key: string) => (await call(key, "tools/list")).tools.map((t: { name: string }) => t.name);

  expect(await tools(reader)).not.toContain("create_page");
  expect(await tools(maker)).toEqual(expect.arrayContaining(["create_page", "create_database", "create_playbook"]));
  const refused = await call(reader, "tools/call", { name: "create_page", arguments: { title: "Nope" } });
  expect(refused.isError).toBe(true);

  // A page inside the hub: the open tab shows it without a reload.
  const made = await call(maker, "tools/call", {
    name: "create_page",
    arguments: {
      title: "Agent notes",
      content: "## From Claude\n\n- [ ] Check the gutters",
      parent_page_id: account!.ids.hub,
    },
  });
  expect(made.isError).toBe(false);
  expect(made.structuredContent.url).toBe(`${baseURL}/p/${made.structuredContent.page_id}`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await expect(sidebar.locator(".tree-row", { hasText: "Agent notes" })).toBeVisible();
  await page.goto(made.structuredContent.url);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Agent notes");
  await expect(page.getByLabel("Page content", { exact: true })).toContainText("Check the gutters");

  // A database with rows.
  const db = await call(maker, "tools/call", {
    name: "create_database",
    arguments: {
      title: "Repairs",
      properties: [
        { name: "Cost", type: "currency" },
        { name: "Done", type: "checkbox" },
      ],
      rows: [
        { Name: "Fix the gate", Cost: 120, Done: false },
        { Name: "Paint the fence", Cost: 300 },
      ],
    },
  });
  expect(db.isError).toBe(false);
  await page.goto(db.structuredContent.url);
  await expect(page.getByRole("table")).toContainText("Fix the gate");
  await expect(page.getByRole("table")).toContainText("Paint the fence");

  // A playbook people can run.
  const playbook = await call(maker, "tools/call", {
    name: "create_playbook",
    arguments: {
      title: "Move-out check",
      when_to_use: "A tenant moves out.",
      inputs: [{ label: "Unit" }],
      sections: [
        {
          title: "Walkthrough",
          steps: [
            { type: "check", text: "Inspect {{unit}} for damage." },
            { type: "finish", text: "Done" },
          ],
        },
      ],
    },
  });
  expect(playbook.isError).toBe(false);
  await page.goto(playbook.structuredContent.url);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Move-out check");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await agent.dispose();
});

test("an agent key opens only the workspace it was made in", async ({ page, playwright, baseURL }) => {
  const settings = () => page.getByRole("button", { name: "Settings", exact: true }).click();
  const agents = page.getByRole("region", { name: "AI agents" });
  const makeKey = async (name: string) => {
    await settings();
    await agents.getByRole("textbox").fill(name);
    await agents.getByRole("button", { name: "Create key" }).click();
    const key = (await agents.locator(".agent-created code").first().textContent())!.trim();
    await page.keyboard.press("Escape");
    return key;
  };
  const rental = await makeKey("Rental agent");
  // A second workspace, with a page of its own.
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  await page.getByLabel("Workspace name").fill("Side project");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  const start = page.getByLabel("Start this page");
  if (await start.count())
    await start
      .getByRole("button", { name: /^(Empty|Blank|Page)/ })
      .first()
      .click()
      .catch(() => {});
  await page.getByLabel("Page title", { exact: true }).fill("Secret plans");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  // Settings here are this workspace's: none of its keys yet, and a word about the other's.
  await settings();
  await expect(agents).toContainText("Let an AI agent use “Side project”");
  await expect(agents).toContainText("No apps or agent keys for this workspace yet.");
  await expect(agents).toContainText("1 app or key belongs to your other workspaces");
  await expect(agents.locator(".agent-keys")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const side = await makeKey("Side agent");

  const agent = await playwright.request.newContext({ baseURL });
  /** How many pages a search with this key finds. */
  const found = async (key: string, query: string) =>
    (
      await (
        await agent.post("/api/mcp", {
          headers: { Authorization: `Bearer ${key}` },
          data: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "search_workspace", arguments: { query } },
          },
        })
      ).json()
    ).result.structuredContent.total as number;
  expect(await found(rental, "Rent Ledger")).toBeGreaterThan(0);
  expect(await found(rental, "Secret plans")).toBe(0);
  expect(await found(side, "Secret plans")).toBe(1);
  expect(await found(side, "Rent Ledger")).toBe(0);
  await agent.dispose();
});
test("each workspace lists only its own playbooks", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await startFromTemplate(page, "Playbook", /Monthly rent check/);
  await expect(sidebar.getByRole("button", { name: /^Playbooks/ })).toContainText("1");
  // A second workspace has none: no entry, and the Playbooks view is empty.
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  await page.getByLabel("Workspace name").fill("Side project");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(sidebar.getByRole("button", { name: "Workspace: Side project" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Playbooks/ })).toHaveCount(0);
  await page.goto("/p/playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks", level: 1 })).toBeVisible();
  await expect(page.locator(".playbook-row")).toHaveCount(0);
  // Back in the first workspace, it's still there.
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page
    .getByRole("menuitem", { name: /Home|My workspace|Rental/ })
    .first()
    .click();
  await expect(sidebar.getByRole("button", { name: /^Playbooks/ })).toContainText("1");
});
test("an agent allowed to edit changes pages and rows, without losing what you're typing", async ({
  page,
  playwright,
  baseURL,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const agents = page.getByRole("region", { name: "AI agents" });
  await agents.getByRole("textbox").fill("Editor");
  await agents.getByRole("radio", { name: /Read, create and edit/ }).check();
  await agents.getByRole("button", { name: "Create key" }).click();
  const key = (await agents.locator(".agent-created code").first().textContent())!.trim();
  await expect(agents.locator(".agent-keys li", { hasText: "Editor" })).toContainText("Read, create and edit");
  await page.keyboard.press("Escape");

  const agent = await playwright.request.newContext({ baseURL });
  const call = async (name: string, args: object) =>
    (
      await (
        await agent.post("/api/mcp", {
          headers: { Authorization: `Bearer ${key}` },
          data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
        })
      ).json()
    ).result;

  // You're in the middle of writing on one page…
  await page.goto(`/p/${account!.ids.guide}`);
  const editor = page.getByLabel("Page content", { exact: true });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" My own words.");
  // …while the agent edits another page and a database row.
  const edited = await call("update_page", {
    page_id: account!.ids.log,
    replace: [{ find: "Review outstanding balances", replace_with: "Review balances with the agent" }],
  });
  expect(edited.isError).toBe(false);
  const rows = await call("query_database", { database: "Rent Ledger", limit: 1 });
  const row = rows.structuredContent.rows[0];
  const changed = await call("update_database", {
    database: "Rent Ledger",
    update_rows: [{ row_id: row.id, values: { Status: "Overdue" } }],
  });
  expect(changed.isError).toBe(false);
  // Your save merges with the agent's changes instead of failing.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText(/changed in another tab/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Page content", { exact: true })).toContainText("My own words.");
  await page.goto(`/p/${account!.ids.log}`);
  await expect(page.getByLabel("Page content", { exact: true })).toContainText("Review balances with the agent");

  // Trash is the furthest it goes, and the page can come back.
  const trashed = await call("trash_page", { page_id: account!.ids.guide });
  expect(trashed.content[0].text).toContain("can be restored");
  await agent.dispose();
});

test("an agent links databases both ways, sets icons and sets up a view", async ({ page, playwright, baseURL }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const agents = page.getByRole("region", { name: "AI agents" });
  await agents.getByRole("textbox").fill("Organizer");
  await agents.getByRole("radio", { name: /Read, create and edit/ }).check();
  await agents.getByRole("button", { name: "Create key" }).click();
  const key = (await agents.locator(".agent-created code").first().textContent())!.trim();
  await page.keyboard.press("Escape");
  const agent = await playwright.request.newContext({ baseURL });
  const call = async (name: string, args: object) =>
    (
      await (
        await agent.post("/api/mcp", {
          headers: { Authorization: `Bearer ${key}` },
          data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
        })
      ).json()
    ).result;

  // A relation from units to tenants, filled in by title: it shows on both databases.
  const linked = await call("update_database", {
    database: "Properties & Units",
    icon: "house:orange",
    add_properties: [{ name: "Tenant", type: "relation", related_database: "Tenants", limit: "one" }],
    update_rows: [
      {
        row_id: (await call("query_database", { database: "Properties & Units" })).structuredContent.rows[0].id,
        values: { Tenant: "Alex Morgan" },
      },
    ],
  });
  expect(linked.isError, linked.content[0].text).toBe(false);
  expect(linked.content[0].text).toContain("added to Tenants");
  // A view of tenants with only their email showing.
  const view = await call("update_database_view", {
    database: "Tenants",
    create: true,
    name: "Contacts",
    visible_properties: ["Email", "Properties & Units"],
    sorts: [{ property: "Tenant name" }],
  });
  expect(view.isError, view.content[0].text).toBe(false);
  const listed = await call("list_databases", {});
  expect(listed.content[0].text).toMatch(/Tenant \(relation to Tenants\)/);
  expect(listed.content[0].text).toContain("Contacts (table)");

  await page.goto(`/p/${account!.ids.tenants}`);
  await expect(page.getByRole("tab", { name: "Contacts" })).toBeVisible();
  await page.getByRole("tab", { name: "Contacts" }).click();
  const table = page.locator(".database-view").first();
  await expect(table.locator(".db-column-trigger", { hasText: "Properties & Units" })).toBeVisible();
  await expect(table.locator(".db-relation-chip", { hasText: "Basement" })).toBeVisible();
  await page.goto(`/p/${account!.ids.units}`);
  await expect(page.locator(".db-relation-chip", { hasText: "Alex Morgan" }).first()).toBeVisible();
  await expect(page.locator(".page-icon-color-orange").first()).toBeVisible();
  await agent.dispose();
});
test("going to the front page and back returns to the page you were on, in each workspace", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const title = page.getByLabel("Page title", { exact: true });
  await sidebar.locator(".tree-page", { hasText: "Workspace notes" }).first().click();
  await expect(title).toHaveValue("Workspace notes");
  const notes = page.url();
  // Out to the front page and back in through "Open Slate".
  await sidebar.getByRole("link", { name: "Slate home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Open Slate" }).first().click();
  await expect(title).toHaveValue("Workspace notes");
  // The address names the page, so reloading keeps it; Back goes to the front page.
  await expect(page).toHaveURL(notes);
  await page.reload();
  await expect(title).toHaveValue("Workspace notes");
  await page.goto("/app");
  await expect(title).toHaveValue("Workspace notes");
  await expect(page).toHaveURL(notes);

  // Each workspace remembers its own page.
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: "Create workspace" }).click();
  await page.getByLabel("Workspace name").fill("Side project");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await sidebar.getByRole("button", { name: "New page", exact: true }).first().click();
  const start = page.getByLabel("Start this page");
  if (await start.count())
    await start
      .getByRole("button", { name: /^(Empty|Blank|Page)/ })
      .first()
      .click()
      .catch(() => {});
  await title.fill("Side notes");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: "Home" }).click();
  await expect(title).toHaveValue("Workspace notes");
  await page.getByRole("button", { name: /^Workspace: / }).click();
  await page.getByRole("menuitem", { name: "Side project" }).click();
  await expect(title).toHaveValue("Side notes");
});
test("a page's address never shows a different page, and New page waits for the workspace", async ({ page }) => {
  const title = page.getByLabel("Page title", { exact: true });
  // A page that isn't there says so, instead of opening another page in its place.
  await page.goto("/p/00000000-0000-4000-8000-0000000000ff");
  await expect(page.getByRole("heading", { name: "This page isn’t here." })).toBeVisible();
  await expect(title).toHaveCount(0);
  await page.getByRole("button", { name: "Go to your pages" }).click();
  await expect(title).toBeVisible();
  // A page in the Trash can be restored from its address.
  await page.goto(`/p/${account!.ids.guide}`);
  await expect(title).toHaveValue("Getting started");
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("menuitem", { name: /Move to trash/i }).click();
  await page.goto(`/p/${account!.ids.guide}`);
  await expect(page.getByRole("heading", { name: "“Getting started” is in the Trash." })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(title).toHaveValue("Getting started");
  // New page, clicked while the workspace is still loading, makes a new page once it's there.
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await expect(title).toHaveValue("");
  await expect(page.getByLabel("Start this page")).toBeVisible();
});
test("menus hand focus back to what opened them when closed with Escape", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  const icon = page.getByRole("button", { name: "Change page icon" });
  await icon.click();
  await expect(page.getByLabel("Choose a page icon")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(icon).toBeFocused();
});
test("menus fade away when they close, and spinners keep turning for reduced motion", async ({ page }) => {
  await page.goto(`/p/${account!.ids.hub}`);
  await page.getByRole("button", { name: "Page options" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Watch the menu as it closes: it plays its closing animation before it's removed.
  const closing = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const surface = document.querySelector<HTMLElement>(".menu-surface")!;
        new MutationObserver(() => {
          if (surface.dataset.state === "closed") resolve(getComputedStyle(surface).animationName);
        }).observe(surface, { attributes: true });
        setTimeout(() => resolve("none"), 1000);
      }),
  );
  await page.keyboard.press("Escape");
  expect(await closing).toBe("menu-out");
  await expect(menu).toBeHidden();
  // With reduced motion, a loading spinner still turns (a frozen one looks like a hang).
  await page.emulateMedia({ reducedMotion: "reduce" });
  const spinning = await page.evaluate(() => {
    const spinner = document.createElement("span");
    spinner.className = "spin";
    document.body.append(spinner);
    const style = getComputedStyle(spinner);
    const result = { duration: style.animationDuration, count: style.animationIterationCount };
    spinner.remove();
    return result;
  });
  expect(spinning).toEqual({ duration: "1.6s", count: "infinite" });
});
test("a page added inside another is listed under Pages inside, leaving the parent's text as it was", async ({
  page,
}) => {
  await page.goto(`/p/${account!.ids.guide}`);
  const title = page.getByLabel("Page title", { exact: true });
  await expect(title).toHaveValue("Getting started");
  const text = await page.getByLabel("Page content", { exact: true }).textContent();
  // The sidebar's "+" on Getting started makes a page inside it.
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const row = sidebar.locator(".tree-row", { hasText: "Getting started" }).first();
  await row.hover();
  await row.getByRole("button", { name: "Add a page inside Getting started" }).click();
  await title.fill("world");
  await page.goto(`/p/${account!.ids.guide}`);
  const inside = page.getByRole("region", { name: "Pages inside" });
  await expect(inside.getByRole("button", { name: "world" })).toBeVisible();
  expect(await page.getByLabel("Page content", { exact: true }).textContent()).toBe(text);
  // "Add a page" there makes another.
  await inside.getByRole("button", { name: "Add a page" }).click();
  await title.fill("animals");
  await page.goto(`/p/${account!.ids.guide}`);
  await expect(inside.getByRole("button", { name: /^(world|animals)$/ })).toHaveCount(2);
  // "Add to page" puts links to them in the text instead.
  await inside.getByRole("button", { name: "Add to page" }).click();
  await expect(inside).toHaveCount(0);
  await expect(page.getByLabel("Page content", { exact: true }).locator(".editor-page-reference")).toHaveCount(2);
});
test("relation cells: one record replaces, any number adds, linked ones can be unlinked, and new ones created", async ({
  page,
}) => {
  // The ledger's Tenant column links to the Tenants database (Alex Morgan on every row).
  // A cell's text is its linked records; the empty part of the cell opens the picker.
  const cell = (row: number) => page.locator("tbody tr").nth(row).locator(".db-cell-anchor");
  const trigger = (row: number) => page.locator("tbody tr").nth(row).locator(".db-relation-trigger");
  const pick = async (row: number) => {
    const box = (await trigger(row).boundingBox())!;
    await trigger(row).click({ position: { x: box.width - 8, y: box.height / 2 } });
  };
  const picker = page.locator(".db-menu", { has: page.getByLabel("Search related records") });
  await expect(cell(1)).toContainText("Alex Morgan");
  // Limit it to one record.
  await page.locator(".db-column-trigger", { hasText: "Tenant" }).click();
  await page.locator(".db-menu").getByLabel("Limit").selectOption("1");
  await page.keyboard.press("Escape");
  // Picking replaces; a name that isn't there yet can be created and linked in one go.
  await pick(1);
  await expect(picker).toContainText("Linked");
  await picker.getByLabel("Search related records").fill("Bea Brown");
  await picker.getByRole("button", { name: /Create “Bea Brown” in Tenants/ }).click();
  await expect(picker).toBeHidden();
  await expect(cell(1)).toHaveText("Bea Brown");
  await expect(cell(0)).toHaveText("Alex Morgan");
  await pick(1);
  await picker.locator(".db-relation-option", { hasText: "Alex Morgan" }).locator(".db-relation-pick").click();
  await expect(cell(1)).toHaveText("Alex Morgan");
  // With no limit, picking adds, the cell says how many more there are, and Unlink removes one.
  await page.locator(".db-column-trigger", { hasText: "Tenant" }).click();
  await page.locator(".db-menu").getByLabel("Limit").selectOption("");
  await page.keyboard.press("Escape");
  await pick(2);
  await picker.locator(".db-relation-option", { hasText: "Bea Brown" }).locator(".db-relation-pick").click();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cell(2)).toHaveText("Alex Morgan+1");
  await expect(trigger(2)).toHaveAttribute("title", "Alex Morgan, Bea Brown");
  await pick(2);
  await picker.getByRole("button", { name: "Unlink Alex Morgan" }).click();
  await page.keyboard.press("Escape");
  await expect(cell(2)).toHaveText("Bea Brown");
  // It all saves (the app keeps a draft until the server has everything).
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("slate-pending:"))))
    .toBe(false);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(cell(1)).toHaveText("Alex Morgan");
  await expect(cell(2)).toHaveText("Bea Brown");
});
test("linked records open in the side panel over the table, with back and close like Notion", async ({ page }) => {
  const title = page.getByLabel("Page title", { exact: true });
  await expect(title).toHaveValue("Rent Ledger");
  const ledger = page.url();
  const panel = page.getByRole("dialog");
  const recordTitle = panel.getByRole("textbox", { name: "Record title" });
  // A tenant in a row's cell opens in the side panel; the ledger stays behind it.
  await page.locator("tbody tr").first().getByRole("button", { name: "Alex Morgan" }).click();
  await expect(recordTitle).toHaveValue("Alex Morgan");
  await expect(panel.getByRole("button", { name: "Open Tenants" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
  expect(page.url()).toBe(ledger);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(title).toHaveValue("Rent Ledger");
  // From a row open in the panel, its tenant opens on top, and Back returns to the row.
  await page.getByRole("button", { name: "Open 2026-04 — Basement", exact: true }).click();
  await expect(recordTitle).toHaveValue("2026-04 — Basement");
  await panel.locator(".db-record-properties").getByRole("button", { name: "Alex Morgan" }).click();
  await expect(recordTitle).toHaveValue("Alex Morgan");
  await panel.getByRole("button", { name: "Back to 2026-04 — Basement" }).click();
  await expect(recordTitle).toHaveValue("2026-04 — Basement");
  // Closing from a linked record closes the panel altogether, back to the ledger.
  await panel.locator(".db-record-properties").getByRole("button", { name: "Alex Morgan" }).click();
  await expect(recordTitle).toHaveValue("Alex Morgan");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(ledger);
  await expect(title).toHaveValue("Rent Ledger");
});
test("code blocks: colored syntax, a searchable language picker that detects the language, Tab to indent", async ({
  page,
}) => {
  await createPage(page, "Snippets");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  const block = page.locator(".editor-code-block");
  await expect(block).toBeVisible();
  await page.keyboard.type("interface User { id: number }\nconst greet = (user: User): string => `Hi ${user.id}`;");
  // Colored as it's typed, with the language detected (and said to be a guess).
  await expect(block.locator(".hljs-keyword").first()).toBeVisible();
  const picker = block.getByRole("button", { name: /^Code language/ });
  await expect(picker).toContainText("TypeScript");
  await expect(picker).toContainText("auto");
  // Tab indents inside the code.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("return");
  await expect(block.locator(".code-content")).toContainText("\n  return");
  // Choose one by searching; it's saved with the page's Markdown.
  await picker.click();
  await page.getByLabel("Search languages").fill("py");
  await page.getByRole("option", { name: "Python" }).click();
  await expect(picker).toHaveText("Python");
  await page.getByRole("button", { name: "Markdown" }).click();
  await expect(page.locator(".cm-content")).toContainText("```python");
});
test("the phone's keyboard toolbar never shows with a mouse and keyboard (Tab nests instead)", async ({ page }) => {
  await createPage(page, "Errands");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("[] Groceries");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Milk");
  await expect(page.getByRole("toolbar", { name: "Editing" })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Page content", { exact: true }).locator('ul[data-type="taskList"] ul[data-type="taskList"] > li'),
  ).toHaveCount(1);
});
