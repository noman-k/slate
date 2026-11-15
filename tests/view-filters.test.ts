import { describe, expect, it } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import { visibleRecords, removeProperty } from "../src/lib/database";
import { planEdit } from "../src/lib/agent-edits";
import {
  describeFilter,
  filterTree,
  mapStoredRules,
  newRule,
  operatorsFor,
  retarget,
  ruleMatches,
  storedFilters,
  treeMatches,
  type FilterGroup,
} from "../src/lib/view-filters";
import type { CellValue, PropertyType, ViewFilter } from "../src/lib/types";

const rule = (property_id: string, operator: ViewFilter["operator"], value = ""): ViewFilter => ({
  property_id,
  operator,
  value,
});

describe("stored filters", () => {
  it("keeps the old shape for rules that must all match, and a root group otherwise", () => {
    const flat: FilterGroup = { type: "group", conjunction: "and", rules: [rule("a", "equals", "x")] };
    expect(storedFilters(flat)).toEqual([rule("a", "equals", "x")]);
    expect(filterTree(storedFilters(flat))).toEqual(flat);
    const or: FilterGroup = {
      type: "group",
      conjunction: "or",
      rules: [rule("a", "equals", "x"), { type: "group", conjunction: "and", rules: [rule("b", "is_empty")] }],
    };
    const stored = storedFilters(or);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ type: "group", root: true, conjunction: "or" });
    expect(filterTree(stored)).toEqual(or);
    // Old views: a plain list means all of them.
    expect(filterTree([rule("a", "contains", "y")]).conjunction).toBe("and");
  });

  it("drops a deleted property's rules, and groups left empty", () => {
    const stored = storedFilters({
      type: "group",
      conjunction: "or",
      rules: [rule("a", "equals", "x"), { type: "group", conjunction: "and", rules: [rule("gone", "is_empty")] }],
    });
    expect(mapStoredRules(stored, (r) => (r.property_id === "gone" ? null : r))).toEqual([rule("a", "equals", "x")]);
  });
});

describe("conditions by type", () => {
  const match = (type: PropertyType, value: CellValue, operator: ViewFilter["operator"], wanted = "") =>
    ruleMatches(rule("p", operator, wanted), type, value);

  it("text", () => {
    expect(match("text", "Horse Shipping", "contains", "ship")).toBe(true);
    expect(match("text", "Horse Shipping", "not_contains", "ship")).toBe(false);
    expect(match("text", "Horse Shipping", "starts_with", "horse")).toBe(true);
    expect(match("text", "Horse Shipping", "ends_with", "horse")).toBe(false);
    expect(match("text", "", "is_empty")).toBe(true);
    expect(match("text", "a", "is_not_empty")).toBe(true);
  });
  it("numbers", () => {
    expect(match("number", 10, "greater_or_equal", "10")).toBe(true);
    expect(match("number", 10, "less_than", "10")).toBe(false);
    expect(match("number", 10, "equals", "10.0")).toBe(true);
    expect(match("number", null, "greater_than", "1")).toBe(false);
  });
  it("dates", () => {
    expect(match("date", "2026-11-14", "before", "2026-12-01")).toBe(true);
    expect(match("datetime", "2026-11-14T09:00:00Z", "equals", "2026-11-14")).toBe(true);
    expect(match("date", "2026-11-14", "on_or_after", "2026-11-14")).toBe(true);
    expect(match("date", null, "after", "2026-01-01")).toBe(false);
  });
  it("choices, lists, relations and checkboxes", () => {
    expect(match("status", "Done", "not_equals", "Done")).toBe(false);
    expect(match("multi_select", ["Task", "Bug"], "contains", "bug")).toBe(true);
    expect(match("relation", ["r1"], "not_contains", "r1")).toBe(false);
    expect(match("relation", [], "is_empty")).toBe(true);
    expect(match("checkbox", false, "equals", "false")).toBe(true);
    expect(match("checkbox", true, "equals", "false")).toBe(false);
  });
  it("a rule without a value yet hides nothing", () => {
    expect(match("text", "anything", "equals", "")).toBe(true);
    expect(match("number", 3, "greater_than", "")).toBe(true);
  });
  it("offers conditions that suit the type, and keeps what still fits when the property changes", () => {
    expect(operatorsFor("checkbox").map((o) => o.value)).toEqual(["equals"]);
    expect(operatorsFor("date").map((o) => o.value)).toContain("on_or_before");
    expect(newRule({ id: "c", type: "checkbox" })).toEqual(rule("c", "equals", "true"));
    expect(retarget(rule("a", "contains", "x"), { id: "b", type: "text" })).toEqual(rule("b", "contains", "x"));
    expect(retarget(rule("a", "contains", "x"), { id: "n", type: "number" })).toEqual(rule("n", "equals", ""));
  });
});

describe("And, Or and groups", () => {
  const values: Record<string, { type: PropertyType; value: CellValue }> = {
    type: { type: "select", value: "Task" },
    status: { type: "status", value: "In progress" },
  };
  const valueOf = (id: string) => values[id];

  it("matches like Notion's advanced filter", () => {
    // (Type is Task or Type is Issue) and (Status is empty or Status is not Done)
    const tree: FilterGroup = {
      type: "group",
      conjunction: "and",
      rules: [
        {
          type: "group",
          conjunction: "or",
          rules: [rule("type", "equals", "Task"), rule("type", "equals", "Issue")],
        },
        {
          type: "group",
          conjunction: "or",
          rules: [rule("status", "is_empty"), rule("status", "not_equals", "Done")],
        },
      ],
    };
    expect(treeMatches(tree, valueOf)).toBe(true);
    values.status.value = "Done";
    expect(treeMatches(tree, valueOf)).toBe(false);
    expect(describeFilter(tree, (id) => id)).toBe(
      "(type equals Task or type equals Issue) and (status is empty or status not equals Done)",
    );
  });

  it("leaves unfinished rules out, even under Or", () => {
    values.status.value = "Done";
    const tree: FilterGroup = {
      type: "group",
      conjunction: "or",
      rules: [
        rule("status", "equals", "In progress"),
        { type: "group", conjunction: "and", rules: [rule("type", "contains", "")] },
      ],
    };
    expect(treeMatches(tree, valueOf)).toBe(false);
    expect(treeMatches({ ...tree, rules: [rule("type", "equals", "")] }, valueOf)).toBe(true);
  });

  it("filters a view's rows, and forgets a deleted column", () => {
    let state = createSeedState();
    const status = state.properties.find((p) => p.database_id === SEED_IDS.database && p.name === "Status")!;
    const amount = state.properties.find((p) => p.database_id === SEED_IDS.database && p.name === "Amount Due")!;
    const view = { ...state.views.find((v) => v.database_id === SEED_IDS.database)! };
    const all = visibleRecords(SEED_IDS.database, { ...view, filters: [] }, state).length;
    view.filters = storedFilters({
      type: "group",
      conjunction: "or",
      rules: [rule(status.id, "equals", "Paid"), rule(amount.id, "greater_than", "1000000")],
    });
    const paid = visibleRecords(SEED_IDS.database, view, state).length;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(all);
    state = { ...state, views: state.views.map((v) => (v.id === view.id ? view : v)) };
    state = removeProperty(state, status.id);
    const after = state.views.find((v) => v.id === view.id)!;
    expect(after.filters).toEqual([rule(amount.id, "greater_than", "1000000")]);
  });
});

describe("agents", () => {
  it("can ask for rows that match any filter, with conditions that suit each property", () => {
    const state = createSeedState();
    const planned = planEdit(state, "update_database_view", {
      database: "Rent Ledger",
      match: "any",
      filters: [
        { property: "Status", operator: "equals", value: "Paid" },
        { property: "Created", operator: "on_or_after", value: "2026-11-01" },
      ],
    });
    expect(planned.edit.views[0].filters?.[0]).toMatchObject({ type: "group", root: true, conjunction: "or" });
    expect(planned.result.text).toContain("Status equals Paid or Created on or after 2026-11-01");
    expect(() =>
      planEdit(state, "update_database_view", {
        database: "Rent Ledger",
        filters: [{ property: "Status", operator: "starts_with", value: "P" }],
      }),
    ).toThrow(/its operators are/);
  });
});
