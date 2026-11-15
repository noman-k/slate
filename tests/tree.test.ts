import { describe, it, expect } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import type { Page, WorkspaceState } from "../src/lib/types";
import {
  canMovePage,
  breadcrumbs,
  purgePage,
  trashPage,
  dropPlacement,
  movePageTo,
  placementOf,
} from "../src/lib/tree";
describe("page hierarchy", () => {
  it("prevents moving a page into a descendant", () => {
    const s = createSeedState();
    expect(canMovePage(s.pages, SEED_IDS.hub, SEED_IDS.ledger)).toBe(false);
    expect(canMovePage(s.pages, SEED_IDS.ledger, SEED_IDS.hub)).toBe(true);
  });
  it("builds breadcrumb ancestry", () => {
    expect(breadcrumbs(createSeedState().pages, SEED_IDS.ledger).map((p) => p.title)).toEqual([
      "Rental Property Finance Hub",
      "Tenant Rent Log",
      "Rent Ledger",
    ]);
  });
  it("soft-deletes and restores descendants together", () => {
    const s = trashPage(createSeedState(), SEED_IDS.hub);
    expect(s.pages.find((p) => p.id === SEED_IDS.ledger)?.deleted_at).toBeTruthy();
    expect(trashPage(s, SEED_IDS.hub, true).pages.find((p) => p.id === SEED_IDS.ledger)?.deleted_at).toBeNull();
  });
});

describe("permanent deletion", () => {
  it("purges a database page with its schema, records and inbound links", () => {
    const state = createSeedState();
    const tenants = state.databases.find((d) => d.page_id === SEED_IDS.tenants)!;
    const tenantRecord = state.records.find((r) => r.database_id === tenants.id)!;
    const purged = purgePage(state, SEED_IDS.tenants);
    expect(purged.pages.some((p) => p.id === SEED_IDS.tenants || p.id === tenantRecord.page_id)).toBe(false);
    expect(purged.databases.some((d) => d.id === tenants.id)).toBe(false);
    expect(purged.properties.some((p) => p.database_id === tenants.id)).toBe(false);
    expect(purged.views.some((v) => v.database_id === tenants.id)).toBe(false);
    expect(purged.records.some((r) => r.database_id === tenants.id)).toBe(false);
    // The ledger keeps its records, but no longer links to or targets the purged database.
    const ledger = state.databases.find((d) => d.page_id === SEED_IDS.ledger)!;
    expect(purged.records.filter((r) => r.database_id === ledger.id)).toHaveLength(9);
    const relation = purged.properties.find((p) => p.database_id === ledger.id && p.type === "relation")!;
    expect(relation.config.related_database_id).toBeUndefined();
    expect(purged.records.every((r) => !JSON.stringify(r.values).includes(tenantRecord.id))).toBe(true);
  });
  it("purges a document subtree including nested databases", () => {
    const purged = purgePage(createSeedState(), SEED_IDS.hub);
    expect(purged.pages.map((p) => p.title).sort()).toEqual(["Getting started", "Workspace notes"]);
    expect(purged.databases).toHaveLength(0);
    expect(purged.records).toHaveLength(0);
    expect(purged.documents.every((d) => purged.pages.some((p) => p.id === d.page_id))).toBe(true);
  });
});

import { normalizePageIcon, parsePageIcon } from "../src/components/page-icon";
describe("page icons", () => {
  it("keeps line icons, converts known emoji, and clears everything else", () => {
    expect(normalizePageIcon("icon:house:orange")).toBe("icon:house:orange");
    expect(normalizePageIcon("🏡")).toBe("icon:house:orange");
    expect(normalizePageIcon("🏘️")).toBe("icon:building:brown");
    expect(normalizePageIcon("🦄")).toBe("");
    expect(normalizePageIcon("file")).toBe("");
    expect(normalizePageIcon("icon:not-real:blue")).toBe("");
    expect(parsePageIcon("icon:house:neon")).toMatchObject({ kind: "icon", name: "house", color: "gray" });
  });
});

describe("dragging pages in the sidebar", () => {
  const mk = (
    id: string,
    parent_id: string | null,
    position: number,
    kind: "document" | "database" = "document",
  ): Page => ({
    id,
    workspace_id: "w",
    parent_id,
    title: id,
    icon: "",
    kind,
    description: "",
    position,
    favorite: false,
    deleted_at: null,
    created_at: "",
    updated_at: "",
  });
  // root: A, B (with B1, B2), C, D (a database)
  const pages = [
    mk("A", null, 0),
    mk("B", null, 1),
    mk("B1", "B", 0),
    mk("B2", "B", 1),
    mk("C", null, 2),
    mk("D", null, 3, "database"),
  ];
  const state: WorkspaceState = {
    workspaces: [],
    documents: [],
    databases: [],
    properties: [],
    records: [],
    views: [],
    active_workspace_id: "w",
    pages,
  };
  const order = (s: WorkspaceState, parent: string | null) =>
    s.pages
      .filter((p) => p.parent_id === parent)
      .sort((a, b) => a.position - b.position)
      .map((p) => p.id);

  it("places above, below and inside a row", () => {
    expect(dropPlacement(pages, "C", "A", "before")).toEqual({ parentId: null, index: 0 });
    expect(dropPlacement(pages, "C", "A", "after")).toEqual({ parentId: null, index: 1 });
    expect(dropPlacement(pages, "C", "A", "inside")).toEqual({ parentId: "A", index: 0 });
    expect(dropPlacement(pages, "A", "B", "inside")).toEqual({ parentId: "B", index: 2 });
  });
  it("drops below an expanded page as its first subpage", () => {
    expect(dropPlacement(pages, "C", "B", "after", new Set(["B"]))).toEqual({ parentId: "B", index: 0 });
    expect(dropPlacement(pages, "C", "B", "after")).toEqual({ parentId: null, index: 2 });
  });
  it("refuses drops into itself, its own subpages, or a database", () => {
    expect(dropPlacement(pages, "B", "B1", "inside")).toBeNull();
    expect(dropPlacement(pages, "B", "B1", "before")).toBeNull();
    expect(dropPlacement(pages, "A", "D", "inside")).toBeNull();
    expect(dropPlacement(pages, "A", "A", "before")).toBeNull();
  });
  it("moves a page to any level and renumbers both levels' order", () => {
    const out = movePageTo(state, "B2", null, 0);
    expect(order(out, null)).toEqual(["B2", "A", "B", "C", "D"]);
    expect(order(out, "B")).toEqual(["B1"]);
    const back = movePageTo(out, "B2", "B", placementOf(state.pages, "B2")!.index);
    expect(order(back, "B")).toEqual(["B1", "B2"]);
    // Inserting, not swapping: C moves between A and B.
    expect(order(movePageTo(state, "C", null, 1), null)).toEqual(["A", "C", "B", "D"]);
  });
});
