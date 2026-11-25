import { describe, expect, it } from "vitest";
import {
  cellValue,
  csvExport,
  duplicateProperty,
  evaluateFormula,
  renameProperty,
  orderProperties,
  removeProperty,
  removeRecord,
  restoreRemovedRecord,
  updateCell,
  visibleRecords,
  changePins,
} from "../src/lib/database";
import type { DatabaseView, Property, WorkspaceState } from "../src/lib/types";
import { createSeedState, SEED_IDS } from "./fixtures/seed";

const date = "2026-11-11T10:00:00.000Z";
const properties: Property[] = [
  { id: "title", database_id: "rent", name: "Name", type: "title", position: 0, width: 300, config: {} },
  { id: "amount", database_id: "rent", name: "Amount", type: "number", position: 1, width: 200, config: {} },
  {
    id: "relation",
    database_id: "rent",
    name: "Related",
    type: "relation",
    position: 2,
    width: 200,
    config: { related_database_id: "rent", reciprocal_property_id: "inverse" },
  },
  {
    id: "inverse",
    database_id: "rent",
    name: "Inverse",
    type: "relation",
    position: 3,
    width: 200,
    config: { related_database_id: "rent" },
  },
  {
    id: "sum",
    database_id: "rent",
    name: "Related total",
    type: "rollup",
    position: 4,
    width: 200,
    config: { relation_property_id: "relation", rollup_property_id: "amount", aggregation: "sum" },
  },
];
const state: WorkspaceState = {
  workspaces: [],
  active_workspace_id: "w",
  pages: [
    {
      id: "p2",
      workspace_id: "w",
      parent_id: null,
      title: "March",
      icon: "file",
      kind: "document",
      description: "",
      position: 0,
      favorite: false,
      deleted_at: null,
      created_at: date,
      updated_at: date,
    },
  ],
  documents: [],
  databases: [{ id: "rent", page_id: "dbp", workspace_id: "w", name: "Rent" }],
  properties,
  views: [],
  records: [
    {
      id: "one",
      database_id: "rent",
      page_id: "p1",
      position: 0,
      created_at: date,
      updated_at: date,
      values: { title: "April", amount: 100, relation: ["two"] },
    },
    {
      id: "two",
      database_id: "rent",
      page_id: "p2",
      position: 1,
      created_at: date,
      updated_at: date,
      values: { title: "March", amount: 200, inverse: ["one"] },
    },
  ],
};
const view: DatabaseView = {
  id: "v",
  database_id: "rent",
  name: "All",
  type: "table",
  filters: [],
  sorts: [],
  hidden_properties: [],
};

describe("safe formulas", () => {
  it("supports precedence, references, conditions and string functions", () => {
    expect(evaluateFormula('prop("Amount") * 2 + 3', { Amount: 10 })).toBe(23);
    expect(evaluateFormula('if(prop("Amount") > 5, concat(upper("paid"), "!"), "Due")', { Amount: 10 })).toBe("PAID!");
    expect(evaluateFormula("round(10 / 3, 2)", {})).toBe(3.33);
    expect(evaluateFormula('concat(")", "!", "(", ",", "==")', {})).toBe(")!(,==");
    expect(() => evaluateFormula('"one" "+" "two"', {})).toThrow();
    expect(evaluateFormula("if(false, 1 / 0, 5)", {})).toBe(5);
    expect(evaluateFormula("false && (1 / 0)", {})).toBe(false);
    expect(evaluateFormula("true || (1 / 0)", {})).toBe(true);
    expect(() => evaluateFormula('prop("constructor")', {})).toThrow("Unknown property");
    expect(evaluateFormula('dateBetween("2026-11-11", "2026-11-01")', {})).toBe(10);
  });
  it("rejects code execution, prototype access and invalid arithmetic", () => {
    for (const text of [
      'eval("alert(1)")',
      'constructor("return process")()',
      'prop("x").constructor',
      "1 / 0",
      "globalThis.process",
      "1 2",
      'constructor("return globalThis")',
      '__proto__("x")',
      'import("node:fs")',
      'prop("x")["constructor"]',
    ])
      expect(() => evaluateFormula(text, {})).toThrow();
  });
});
describe("database data operations", () => {
  it("orders columns independently per view with stable schema fallback for new properties", () => {
    expect(orderProperties(properties).map((property) => property.id)).toEqual([
      "title",
      "amount",
      "relation",
      "inverse",
      "sum",
    ]);
    expect(orderProperties(properties, ["sum", "missing", "relation"]).map((property) => property.id)).toEqual([
      "title",
      "sum",
      "relation",
      "amount",
      "inverse",
    ]);
    expect(orderProperties(properties, ["amount", "sum"]).map((property) => property.id)).toEqual([
      "title",
      "amount",
      "sum",
      "relation",
      "inverse",
    ]);
    expect(properties[1].id).toBe("amount");
  });
  it("keeps formula references valid when a property is renamed without changing string literals", () => {
    const formula: Property = {
      ...properties[1],
      id: "formula",
      type: "formula",
      name: "Calculation",
      config: { expression: `prop('Amount') * 2 + length('prop(\"Amount\")')` },
    };
    const renamed = renameProperty({ ...state, properties: [...state.properties, formula] }, "amount", "Rent");
    expect(renamed.properties.find((property) => property.id === "formula")?.config.expression).toBe(
      `prop("Rent") * 2 + length('prop(\"Amount\")')`,
    );
    expect(
      cellValue(
        renamed.records[0],
        renamed.properties.find((property) => property.id === "formula")!,
        renamed,
      ),
    ).toBe(214);
  });
  it("resolves single-quoted computed properties and reports circular references", () => {
    const a: Property = {
      ...properties[1],
      id: "a",
      name: "A",
      type: "formula",
      config: { expression: `prop('Amount') * 2` },
    };
    const b: Property = { ...a, id: "b", name: "B", config: { expression: `prop('A') + 1` } };
    const configured = { ...state, properties: [...state.properties, a, b] };
    expect(cellValue(state.records[0], b, configured)).toBe(201);
    expect(cellValue(state.records[0], { ...a, config: { expression: 'prop("A")' } }, configured)).toBe(
      "#Circular reference",
    );
  });
  it("derives rollups live from the related records", () => {
    expect(cellValue(state.records[0], properties[4], state)).toBe(200);
    const changed = updateCell(state, "two", properties[1], 400);
    expect(cellValue(changed.records[0], properties[4], changed)).toBe(400);
  });
  it("synchronizes reciprocal relations when selections change", () => {
    const changed = updateCell(state, "one", properties[2], []);
    expect(changed.records[1].values.inverse).toEqual([]);
    expect(updateCell(changed, "one", properties[2], ["two"]).records[1].values.inverse).toEqual(["one"]);
  });
  it("removes relation references when a record is deleted", () => {
    const changed = removeRecord(state, "two");
    expect(changed.records).toHaveLength(2);
    expect(changed.pages.find((page) => page.id === "p2")?.deleted_at).toBeTruthy();
    expect(visibleRecords("rent", view, changed)).toHaveLength(1);
    expect(changed.records[0].values.relation).toEqual([]);
  });
  it("undoes a record deletion, restoring its page and the links that pointed to it", () => {
    const deleted = removeRecord(state, "two");
    // An unrelated edit between delete and undo must survive the undo.
    const edited = updateCell(deleted, "one", properties[1], 999);
    const restored = restoreRemovedRecord(edited, state, "two");
    expect(restored.pages.find((page) => page.id === "p2")?.deleted_at).toBeNull();
    expect(restored.records[0].values.relation).toEqual(["two"]);
    expect(restored.records[0].values[properties[1].id]).toBe(999);
    expect(visibleRecords("rent", view, restored)).toHaveLength(2);
  });
  it("trashes nested record pages and hides trashed targets from rollups and relations", () => {
    const child = { ...state.pages[0], id: "nested", parent_id: "p2", title: "Nested note" };
    const nested = { ...state, pages: [...state.pages, child] };
    const deleted = removeRecord(nested, "two");
    expect(deleted.pages.find((page) => page.id === "nested")?.deleted_at).toBeTruthy();
    const genericTrash = { ...state, pages: state.pages.map((page) => ({ ...page, deleted_at: date })) };
    expect(cellValue(genericTrash.records[0], properties[2], genericTrash)).toEqual([]);
    expect(cellValue(genericTrash.records[0], properties[4], genericTrash)).toBe(0);
  });
  it("duplicates property values while keeping copied relations independent", () => {
    const copied = duplicateProperty(state, "relation");
    const property = copied.properties.at(-1)!;
    expect(property.name).toBe("Related copy");
    expect(property.config.reciprocal_property_id).toBeUndefined();
    expect(copied.records[0].values[property.id]).toEqual(["two"]);
    expect(copied.records[1].values.inverse).toEqual(["one"]);
    expect(() => duplicateProperty(state, "title")).toThrow();
  });
  it("deleting a property clears values, reciprocal links, rollup references and view rules", () => {
    const configured = {
      ...state,
      views: [
        {
          ...view,
          filters: [{ property_id: "relation", operator: "contains" as const, value: "two" }],
          sorts: [{ property_id: "relation", direction: "asc" as const }],
          hidden_properties: ["relation"],
          property_order: ["title", "relation", "amount"],
          group_by: "relation",
        },
      ],
    };
    const deleted = removeProperty(configured, "relation");
    expect(deleted.properties.some((property) => property.id === "relation")).toBe(false);
    expect(deleted.properties.find((property) => property.id === "sum")?.config.relation_property_id).toBeUndefined();
    expect(deleted.records[0].values.relation).toBeUndefined();
    expect(deleted.records[1].values.inverse).toEqual([]);
    expect(deleted.views[0]).toMatchObject({
      filters: [],
      sorts: [],
      hidden_properties: [],
      property_order: ["title", "amount"],
      group_by: undefined,
    });
    expect(() => removeProperty(state, "title")).toThrow();
  });
  it("rejects orphaned, incorrect-database and cross-workspace relations", () => {
    expect(() => updateCell(state, "one", properties[2], ["missing"])).toThrow();
    const other = {
      ...state,
      databases: [
        ...state.databases,
        { id: "private", page_id: "private-page", workspace_id: "other-user", name: "Private" },
      ],
      records: [...state.records, { ...state.records[1], id: "private-record", database_id: "private" }],
    };
    expect(() => updateCell(other, "one", properties[2], ["private-record"])).toThrow();
    const crossWorkspace = { ...properties[2], config: { related_database_id: "private" } };
    expect(() => updateCell(other, "one", crossWorkspace, ["private-record"])).toThrow();
  });
  it("applies typed filters, search and stable sorting", () => {
    expect(
      visibleRecords("rent", { ...view, sorts: [{ property_id: "amount", direction: "desc" }] }, state).map(
        (r) => r.id,
      ),
    ).toEqual(["two", "one"]);
    expect(
      visibleRecords(
        "rent",
        { ...view, filters: [{ property_id: "amount", operator: "greater_than", value: "150" }] },
        state,
      ).map((r) => r.id),
    ).toEqual(["two"]);
    expect(visibleRecords("rent", view, state, "APR")).toHaveLength(1);
  });
  it("escapes CSV quotes, delimiters and newlines", () => {
    const changed = updateCell(state, "one", properties[0], 'April, "rent"\npaid');
    expect(csvExport(changed.records, properties.slice(0, 2), changed)).toContain('"April, ""rent""\npaid","100"');
  });
});

describe("pinned rows", () => {
  const state = createSeedState();
  const rows = state.records.filter((record) => record.database_id === SEED_IDS.database);
  const title = state.properties.find((p) => p.database_id === SEED_IDS.database && p.type === "title")!;
  const base = state.views.find((v) => v.database_id === SEED_IDS.database)!;
  const names = (view: DatabaseView) =>
    visibleRecords(SEED_IDS.database, view, state).map((record) => cellValue(record, title, state));

  it("come first, in pin order, whatever the sort; the rest keep the view's order", () => {
    const sorted: DatabaseView = { ...base, filters: [], sorts: [{ property_id: title.id, direction: "asc" }] };
    const unpinned = names(sorted);
    const [a, b] = [rows[3], rows[1]];
    const pinned = names({ ...sorted, pinned: [a.id, b.id] });
    expect(pinned.slice(0, 2)).toEqual([cellValue(a, title, state), cellValue(b, title, state)]);
    expect(pinned.slice(2)).toEqual(unpinned.filter((name) => !pinned.slice(0, 2).includes(name)));
  });

  it("still follow the view's filter", () => {
    const only = String(cellValue(rows[0], title, state));
    const filtered: DatabaseView = {
      ...base,
      sorts: [],
      filters: [{ property_id: title.id, operator: "contains", value: only }],
      pinned: [rows[2].id, rows[0].id],
    };
    const shown = visibleRecords(SEED_IDS.database, filtered, state);
    expect(shown[0].id).toBe(rows[0].id);
    // rows[2] is pinned but the filter leaves it out.
    expect(shown.some((record) => record.id === rows[2].id)).toBe(false);
  });

  it("are added at the end or before another pin, and removed", () => {
    expect(changePins(undefined, ["a"], true)).toEqual(["a"]);
    expect(changePins(["a", "b"], ["c"], true)).toEqual(["a", "b", "c"]);
    expect(changePins(["a", "b"], ["c"], true, "b")).toEqual(["a", "c", "b"]);
    expect(changePins(["a", "b", "c"], ["c"], true, "a")).toEqual(["c", "a", "b"]);
    expect(changePins(["a", "b", "c"], ["b"], false)).toEqual(["a", "c"]);
  });
});
