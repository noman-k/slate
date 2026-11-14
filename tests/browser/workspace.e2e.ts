import { test, expect, type Page } from "@playwright/test";
async function createPage(page: Page, name: string) {
  await page
    .getByRole("button", { name: "New page", exact: true })
    .first()
    .click();
  // New pages open immediately with the cursor in an empty title, like Notion.
  const title = page.getByLabel("Page title", { exact: true });
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("");
  await title.fill(name);
  await expect(page.getByLabel("Page content", { exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(
    "Rent Ledger",
  );
});
test("reference ledger supports live filters and shared board views", async ({
  page,
}) => {
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2026-04 — Basement", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Follow Up", exact: true }).click();
  await expect(page.getByText("No records match your view.")).toBeVisible();
  await page.getByRole("tab", { name: "Paid", exact: true }).click();
  await expect(page.getByText("9 records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "2 more…", exact: true }).click();
  await page.getByRole("button", { name: "By status", exact: true }).click();
  await expect(page.locator(".db-board")).toBeVisible();
  await expect(page.locator(".db-board-card")).toHaveCount(9);
});
test("Markdown shortcuts, code fences, inline database and refresh are lossless", async ({
  page,
}) => {
  await createPage(page, "Round trip verification");
  const editor = page.getByLabel("Page content", { exact: true });
  await editor.pressSequentially("## ");
  await editor.pressSequentially("Persistent heading");
  await expect(
    editor.getByRole("heading", { name: "Persistent heading", level: 2 }),
  ).toBeVisible();
  await editor.press("Enter");
  await editor.pressSequentially("```");
  await editor.pressSequentially("const answer = 42;");
  await editor.press("ControlOrMeta+End");
  await editor.press("ArrowDown");
  await editor.pressSequentially("/database");
  await editor.press("Enter");
  await expect(editor.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "## Persistent heading",
  );
  await expect(page.locator(".cm-content")).toContainText(
    ':::slate {"kind":"database"',
  );
  await page.getByRole("button", { name: "Interactive", exact: true }).click();
  await expect(editor.locator("pre")).toContainText("const answer = 42;");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Persistent heading", level: 2 }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});
test("records have private persistent URLs and editable page content", async ({
  page,
}) => {
  // Clicking a name renames it; the "Open" button opens the record.
  await page
    .getByRole("button", { name: "Open 2026-04 — Basement", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]+$/);
  await page
    .getByRole("textbox", { name: "Record title", exact: true })
    .fill("Updated April rent");
  await page
    .getByLabel("Page content", { exact: true })
    .pressSequentially("Payment receipt received.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Record title", exact: true }),
  ).toHaveValue("Updated April rent");
  await expect(page.getByLabel("Page content", { exact: true })).toContainText(
    "Payment receipt received.",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Updated April rent", exact: true }),
  ).toBeVisible();
});
test("deleted page trees can be restored from Trash", async ({ page }) => {
  await createPage(page, "Recoverable note");
  await page.getByRole("button", { name: "Page options", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Move to trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Recoverable note");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // The restored page is also the open page, so its name appears in the breadcrumb too.
  await page
    .getByRole("complementary", { name: "Workspace navigation" })
    .getByRole("button", { name: "Recoverable note", exact: true })
    .click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(
    "Recoverable note",
  );
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
  await page.getByRole("link", { name: "Try the demo" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Slate home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
test("subpages appear as blocks in their parent and follow moves", async ({ page }) => {
  await createPage(page, "Trip plans");
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const parentRow = sidebar.locator(".tree-row", { hasText: "Trip plans" });
  await parentRow.hover();
  await parentRow.getByRole("button", { name: "Add a page inside Trip plans" }).click();
  await page.getByLabel("Page title", { exact: true }).fill("Packing list");
  // The parent page now shows the subpage as a block in its content.
  await parentRow.locator(".tree-page").click();
  const block = page.locator(".page-body .editor-page-reference", { hasText: "Packing list" });
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
  await page.getByRole("dialog").getByRole("button", { name: /Private pages/ }).click();
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
  await page.getByRole("button", { name: "Open 2026-05 — Basement", exact: true }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(title).toHaveValue("2026-05 — Basement");
  await page.goBack();
  await page.getByRole("button", { name: "Open 2026-05 — Basement", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Record title")).toHaveValue("2026-05 — Basement");
});
test("pages can be dragged above, below or inside others in the sidebar", async ({ page }) => {
  const tree = page.locator('section[aria-label="Private"]');
  const row = (title: string) => tree.locator(".tree-row", { has: page.locator(".tree-title", { hasText: new RegExp(`^${title}$`) }) });
  const outline = () =>
    tree.locator(".tree-row").evaluateAll((rows) =>
      rows.map((r) => `${(r as HTMLElement).style.getPropertyValue("--depth")}:${r.querySelector(".tree-title")?.textContent}`),
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
  await expect.poll(async () => (await outline()).filter((r) => r.startsWith("0:"))).toEqual([
    "0:Rental Property Finance Hub", "0:Workspace notes", "0:Getting started",
  ]);
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
  const block = page.locator(".slate-prose .react-renderer", { has: page.locator(".db-inline-title", { hasText: "Reading list" }) });
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
  await page.getByRole("complementary").locator(".tree-row", { hasText: /^Tenants/ }).locator(".tree-page").click();
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
  const row = (title: string) => tree.locator(".tree-row", { has: page.locator(".tree-title", { hasText: new RegExp(`^${title}$`) }) });
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
test("a new page can start from a playbook or runbook template", async ({ page }) => {
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  const starter = page.getByLabel("Start this page");
  await starter.getByRole("button", { name: "Playbook", exact: true }).click();
  // The dialog is named after the tab you're on ("New playbook" / "New runbook").
  const gallery = page.locator(".procedure-gallery");
  await expect(page.getByRole("dialog", { name: "New playbook" })).toBeVisible();
  // The list is focused: arrow down to "Refund request"; the preview follows.
  await expect(gallery.getByRole("option", { name: /Blank playbook/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(gallery.getByRole("region", { name: "Refund request preview" })).toContainText("Check eligibility");
  // Switching tabs shows runbooks; switching back keeps the playbook you picked.
  await gallery.getByRole("tab", { name: "Runbooks" }).click();
  await expect(page.getByRole("dialog", { name: "New runbook" })).toBeVisible();
  await expect(gallery.getByRole("option", { name: /Incident response/ })).toBeVisible();
  await gallery.getByRole("tab", { name: "Playbooks" }).click();
  await expect(gallery.getByRole("option", { name: /Refund request/ })).toHaveAttribute("aria-selected", "true");
  await gallery.getByRole("button", { name: "Use template" }).click();
  await expect(gallery).toBeHidden();
  // The page takes the template's name, "when to use" description and structure.
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Refund request");
  await expect(page.getByText("When to use: a customer asks for their money back on an order.")).toBeVisible();
  const editor = page.getByLabel("Page content", { exact: true });
  await expect(editor.getByRole("heading", { name: "1 · Check eligibility" })).toBeVisible();
  await expect(starter).toBeHidden();
  // Undo puts the page back the way it was.
  await page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(starter).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("");
  // A runbook keeps a title you already typed, and dates its review.
  await page.getByLabel("Page title", { exact: true }).fill("Ship v2");
  await starter.getByRole("button", { name: "Runbook", exact: true }).click();
  await page.getByRole("dialog", { name: "New runbook" }).getByRole("option", { name: /Deploy a release/ }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Ship v2");
  await expect(editor.getByRole("heading", { name: "Roll back" })).toBeVisible();
  // Today in the browser's own time zone, not UTC.
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  await expect(editor.locator("table")).toContainText(today);
  await page.reload();
  await expect(page.getByLabel("Page content", { exact: true }).getByRole("heading", { name: "Roll back" })).toBeVisible();
});
test("/playbook and /runbook insert a template into a page that has content", async ({ page }) => {
  await page.getByRole("complementary").locator(".tree-title", { hasText: /^Getting started$/ }).click();
  const editor = page.getByLabel("Page content", { exact: true });
  await editor.getByText("Everything in this workspace is private to you.").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/runbook");
  await expect(page.locator(".editor-menu-label", { hasText: "Templates" })).toHaveCount(0); // a query hides group labels
  await page.keyboard.press("Enter");
  const gallery = page.getByRole("dialog", { name: "New runbook" });
  await expect(gallery).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(gallery.getByRole("option", { name: /Deploy a release/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(gallery).toBeHidden();
  // Added below the existing text; the page keeps its own title and content.
  await expect(editor.getByRole("heading", { name: "Roll back" })).toBeVisible();
  await expect(editor.getByRole("heading", { name: "Make yourself at home" })).toBeVisible();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Getting started");
  const order = await editor.locator("h2").allTextContents();
  expect(order.indexOf("Bring a little structure")).toBeLessThan(order.indexOf("Before you start"));
  await expect(editor.locator(".slate-prose > p", { hasText: "/runbook" })).toHaveCount(0);
  // ⌘Z takes it out again.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.getByRole("heading", { name: "Roll back" })).toHaveCount(0);
  await expect(editor.getByRole("heading", { name: "Make yourself at home" })).toBeVisible();
  // Closing the gallery without choosing inserts nothing.
  await page.keyboard.type("/playbook");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "New playbook" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New playbook" })).toBeHidden();
  await expect(editor.getByRole("heading", { name: "Guidelines" })).toHaveCount(0);
});

async function startFromTemplate(page: Page, kind: "Playbook" | "Runbook", template: RegExp) {
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByLabel("Start this page").getByRole("button", { name: kind, exact: true }).click();
  await page.locator(".procedure-gallery").getByRole("option", { name: template }).click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".procedure-gallery")).toBeHidden();
}
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
test("step blocks and parameters can be added with slash commands", async ({ page }) => {
  await createPage(page, "Handbook");
  await page.getByLabel("Page title", { exact: true }).press("Enter");
  await page.keyboard.type("/parameters");
  await page.keyboard.press("Enter");
  await page.getByLabel("Parameter name").fill("tenant name");
  await expect(page.getByLabel("Parameter name")).toHaveValue("tenant_name");
  await page.locator(".slate-prose > p").last().click();
  await page.keyboard.type("/ask");
  await page.keyboard.press("Enter");
  await page.keyboard.type("How did {{tenant_name}} pay?");
  await expect(page.locator(".proc-step.is-ask .var-chip")).toHaveText("{{tenant_name}}");
  await page.getByLabel("Save answer as").fill("method");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(page.locator(".run-bar-meta")).toHaveText("1 step · 1 input");
  // Saved as blocks and read back after a reload.
  await page.reload();
  await expect(page.locator(".proc-step.is-ask")).toContainText("How did {{tenant_name}} pay?");
  await expect(page.getByLabel("Save answer as")).toHaveValue("method");
});
