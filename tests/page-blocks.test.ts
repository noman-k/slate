import { describe, expect, it } from "vitest";
import { appendPageBlock, databaseIdsIn, hasPageBlock, isShownInPage, relinkPageBlock, removePageBlocks } from "../src/lib/page-blocks";
import type { Page, WorkspaceState } from "../src/lib/types";

const block = (id: string) => `:::slate {"kind":"page","id":"${id}"}`;

describe("page blocks", () => {
  it("appends a block once, after the existing text", () => {
    const once = appendPageBlock("# Notes\n\nHello\n", "a");
    expect(once).toBe(`# Notes\n\nHello\n\n${block("a")}\n`);
    expect(appendPageBlock(once, "a")).toBe(once);
    expect(appendPageBlock("", "a")).toBe(`${block("a")}\n`);
  });

  it("ignores directive-looking lines inside code fences", () => {
    const fenced = "```\n" + block("a") + "\n```\n";
    expect(hasPageBlock(fenced, "a")).toBe(false);
  });

  it("removes a block without leaving a gap", () => {
    const md = `Intro\n\n${block("a")}\n\n${block("b")}\n`;
    expect(removePageBlocks(md, "a")).toBe(`Intro\n\n${block("b")}\n`);
    expect(removePageBlocks("Nothing here", "a")).toBe("Nothing here");
  });

  it("moves a block between parent documents, skipping databases", () => {
    const page = (id: string, kind: Page["kind"] = "document", parent_id: string | null = null): Page => ({
      id, workspace_id: "w", parent_id, title: id, icon: "", kind, description: "",
      position: 0, favorite: false, deleted_at: null, created_at: "", updated_at: "",
    });
    const state: WorkspaceState = {
      workspaces: [], databases: [], properties: [], records: [], views: [], active_workspace_id: "w",
      pages: [page("old"), page("new"), page("db", "database"), page("child", "document", "old")],
      documents: [{ page_id: "old", markdown: `Hi\n\n${block("child")}\n`, updated_at: "" }],
    };
    const moved = relinkPageBlock(state, "child", "old", "new");
    expect(moved.documents.find((d) => d.page_id === "old")?.markdown).toBe("Hi\n");
    expect(moved.documents.find((d) => d.page_id === "new")?.markdown).toBe(`${block("child")}\n`);
    const intoDb = relinkPageBlock(state, "child", null, "db");
    expect(intoDb).toBe(state);
  });

  it("counts an inline database embed as showing its database page", () => {
    const md = `Notes\n\n:::slate {"kind":"database","id":"db1"}\n`;
    expect(isShownInPage(md, { id: "page1", database_id: "db1" })).toBe(true);
    expect(isShownInPage(md, { id: "page2", database_id: "db2" })).toBe(false);
    expect(isShownInPage(`${block("page3")}\n`, { id: "page3" })).toBe(true);
  });

  it("lists the databases embedded in a page, once each", () => {
    const db = (id: string) => `:::slate {"kind":"database","id":"${id}"}`;
    expect(databaseIdsIn(`Intro\n\n${db("a")}\n\n${block("p")}\n\n${db("b")}\n\n${db("a")}\n`)).toEqual(["a", "b"]);
    expect(databaseIdsIn("```\n" + db("x") + "\n```\n")).toEqual([]);
  });
});

describe("moving a database out of its page", () => {
  it("turns the embed left behind into a linked view with its own views", async () => {
    const { relinkPageBlock: relink } = await import("../src/lib/page-blocks");
    const page = (id: string, kind: Page["kind"], parent_id: string | null, database_id?: string): Page => ({
      id, workspace_id: "w", parent_id, title: id, icon: "", kind, description: "", database_id,
      position: 0, favorite: false, deleted_at: null, created_at: "", updated_at: "",
    });
    const state: WorkspaceState = {
      workspaces: [], databases: [], properties: [], records: [], active_workspace_id: "w",
      views: [{ id: "v1", database_id: "d1", name: "Table", type: "table", filters: [], sorts: [], hidden_properties: [] }],
      pages: [page("host", "document", null), page("other", "document", null), page("dbp", "database", "host", "d1")],
      documents: [{ page_id: "host", markdown: `Hi\n\n:::slate {"kind":"database","id":"d1"}\n`, updated_at: "" }],
    };
    const moved = relink(state, "dbp", "host", "other");
    const md = moved.documents.find((d) => d.page_id === "host")!.markdown;
    const block = /"block":"([^"]+)"/.exec(md)?.[1];
    expect(block).toBeTruthy();
    expect(moved.views.filter((v) => v.placement === block)).toMatchObject([{ database_id: "d1", type: "table" }]);
    expect(moved.views.find((v) => v.id === "v1")?.placement).toBeUndefined();
    // Moving it back into a page that already shows it adds no extra page link.
    const back = relink(moved, "dbp", "other", "host");
    expect(back.documents.find((d) => d.page_id === "host")!.markdown).toBe(md);
  });
});
