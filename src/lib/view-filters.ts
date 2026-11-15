/**
 * A view's filter, as in Notion: rules joined by And or Or, and groups of rules (with their
 * own And or Or) among them. Each column type has the conditions that make sense for it
 * (text contains, a number is greater than, a date is before, a select is one of its
 * choices…), and a rule that isn't finished yet (no value) doesn't hide anything.
 *
 * Stored in `view.filters`: a plain list of rules means all of them must match (the shape
 * views always had, still used while that's all a filter is); anything else is stored as
 * one root group, `[{ type: "group", root: true, conjunction, rules }]`.
 */
import type { CellValue, DatabaseView, PropertyType, ViewFilter, ViewFilterGroup } from "./types";

export type FilterOperator = ViewFilter["operator"];
export type Conjunction = "and" | "or";
export type FilterGroup = ViewFilterGroup;
export type FilterNode = ViewFilter | FilterGroup;

export const isGroup = (node: FilterNode | undefined): node is FilterGroup =>
  !!node && (node as FilterGroup).type === "group";

/** The filter as a tree: its root group. */
export function filterTree(filters: DatabaseView["filters"] | undefined): FilterGroup {
  const list: FilterNode[] = filters ?? [];
  if (list.length === 1 && isGroup(list[0]) && list[0].root)
    return { type: "group", conjunction: list[0].conjunction, rules: list[0].rules };
  return { type: "group", conjunction: "and", rules: list };
}

/** The tree as stored: a plain list when it's only rules that must all match. */
export function storedFilters(tree: FilterGroup): DatabaseView["filters"] {
  const rules = tree.rules.filter((node) => !isGroup(node) || node.rules.length > 0);
  if ((tree.conjunction === "and" || rules.length < 2) && !rules.some(isGroup)) return rules;
  return [{ type: "group", root: true, conjunction: tree.conjunction, rules }];
}

/** Every rule in the tree, groups included. */
export const allRules = (tree: FilterGroup): ViewFilter[] =>
  tree.rules.flatMap((node) => (isGroup(node) ? allRules(node) : [node]));

/** Changes every rule (to rename a property, say); `null` drops it. Empty groups go. */
export function mapRules(tree: FilterGroup, change: (rule: ViewFilter) => ViewFilter | null): FilterGroup {
  const rules: FilterNode[] = [];
  for (const node of tree.rules) {
    if (isGroup(node)) {
      const group = mapRules(node, change);
      if (group.rules.length) rules.push(group);
    } else {
      const rule = change(node);
      if (rule) rules.push(rule);
    }
  }
  return { ...tree, rules };
}

/** The same for a view's stored filters. */
export const mapStoredRules = (filters: DatabaseView["filters"], change: (rule: ViewFilter) => ViewFilter | null) =>
  storedFilters(mapRules(filterTree(filters), change));

/* ---------- Conditions by column type ---------- */

export interface OperatorChoice {
  value: FilterOperator;
  label: string;
  /** False for conditions without a value (is empty, is checked…). */
  takesValue: boolean;
}
const op = (value: FilterOperator, label: string, takesValue = true): OperatorChoice => ({ value, label, takesValue });
const EMPTY = [op("is_empty", "Is empty", false), op("is_not_empty", "Is not empty", false)];
const TEXT = [
  op("contains", "Contains"),
  op("not_contains", "Does not contain"),
  op("equals", "Is"),
  op("not_equals", "Is not"),
  op("starts_with", "Starts with"),
  op("ends_with", "Ends with"),
  ...EMPTY,
];
const NUMBER = [
  op("equals", "="),
  op("not_equals", "≠"),
  op("greater_than", ">"),
  op("less_than", "<"),
  op("greater_or_equal", "≥"),
  op("less_or_equal", "≤"),
  ...EMPTY,
];
const CHOICE = [op("equals", "Is"), op("not_equals", "Is not"), ...EMPTY];
const LIST = [op("contains", "Contains"), op("not_contains", "Does not contain"), ...EMPTY];
const DATE = [
  op("equals", "Is"),
  op("before", "Is before"),
  op("after", "Is after"),
  op("on_or_before", "Is on or before"),
  op("on_or_after", "Is on or after"),
  ...EMPTY,
];
const CHECKBOX = [op("equals", "Is")];

export function operatorsFor(type: PropertyType): OperatorChoice[] {
  switch (type) {
    case "number":
    case "currency":
      return NUMBER;
    case "select":
    case "status":
      return CHOICE;
    case "multi_select":
    case "relation":
      return LIST;
    case "date":
    case "datetime":
    case "created_time":
    case "updated_time":
      return DATE;
    case "checkbox":
      return CHECKBOX;
    case "formula":
    case "rollup":
      return [...TEXT.slice(0, 4), op("greater_than", ">"), op("less_than", "<"), ...EMPTY];
    default:
      return TEXT;
  }
}

export const takesValue = (operator: FilterOperator) => operator !== "is_empty" && operator !== "is_not_empty";

/** A new rule for a property: its first condition, no value yet (a checkbox: checked). */
export const newRule = (property: { id: string; type: PropertyType }): ViewFilter => ({
  property_id: property.id,
  operator: operatorsFor(property.type)[0].value,
  value: property.type === "checkbox" ? "true" : "",
});

/** A rule moved to another property keeps its condition if that property has it. */
export function retarget(rule: ViewFilter, property: { id: string; type: PropertyType }): ViewFilter {
  const operators = operatorsFor(property.type);
  const keeps = operators.some((o) => o.value === rule.operator);
  return {
    property_id: property.id,
    operator: keeps ? rule.operator : operators[0].value,
    value: property.type === "checkbox" ? "true" : keeps && property.type !== "relation" ? rule.value : "",
  };
}

/* ---------- Matching ---------- */

const isEmpty = (value: CellValue | undefined) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
const day = (value: unknown) => String(value ?? "").slice(0, 10);

/** Whether one rule matches a value of a property of this type. Unfinished rules match. */
export function ruleMatches(rule: ViewFilter, type: PropertyType | undefined, value: CellValue | undefined): boolean {
  if (rule.operator === "is_empty") return isEmpty(value);
  if (rule.operator === "is_not_empty") return !isEmpty(value);
  const wanted = String(rule.value ?? "");
  if (!wanted.trim()) return true;
  const needle = wanted.toLowerCase();
  if (type === "checkbox") return Boolean(value) === (needle === "true");
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).toLowerCase());
    const has = items.includes(needle);
    switch (rule.operator) {
      case "contains":
      case "equals":
        return has;
      case "not_contains":
      case "not_equals":
        return !has;
      default:
        return items.some((item) => ruleMatches({ ...rule }, "text", item));
    }
  }
  if (type === "date" || type === "datetime" || type === "created_time" || type === "updated_time") {
    if (isEmpty(value)) return rule.operator === "not_equals";
    const a = day(value),
      b = day(wanted);
    switch (rule.operator) {
      case "equals":
        return a === b;
      case "not_equals":
        return a !== b;
      case "before":
      case "less_than":
        return a < b;
      case "after":
      case "greater_than":
        return a > b;
      case "on_or_before":
      case "less_or_equal":
        return a <= b;
      case "on_or_after":
      case "greater_or_equal":
        return a >= b;
    }
  }
  const numeric = typeof value === "number" || type === "number" || type === "currency";
  switch (rule.operator) {
    case "greater_than":
    case "less_than":
    case "greater_or_equal":
    case "less_or_equal": {
      if (isEmpty(value)) return false;
      const a = Number(value),
        b = Number(wanted);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return rule.operator === "greater_than"
        ? a > b
        : rule.operator === "less_than"
          ? a < b
          : rule.operator === "greater_or_equal"
            ? a >= b
            : a <= b;
    }
  }
  const text = String(value ?? "").toLowerCase();
  const same = numeric && text !== "" ? Number(value) === Number(wanted) : text === needle;
  switch (rule.operator) {
    case "equals":
      return same;
    case "not_equals":
      return !same;
    case "contains":
      return text.includes(needle);
    case "not_contains":
      return !text.includes(needle);
    case "starts_with":
      return text.startsWith(needle);
    case "ends_with":
      return text.endsWith(needle);
    default:
      return true;
  }
}

/** Whether a rule is finished: it has a value, or its condition needs none. */
export const isFinished = (rule: ViewFilter) => !takesValue(rule.operator) || String(rule.value ?? "").trim() !== "";
/** Whether a rule or group filters anything yet (unfinished rules are left out, as in Notion). */
const isActive = (node: FilterNode): boolean => (isGroup(node) ? node.rules.some(isActive) : isFinished(node));

/** Whether a row matches the tree; `valueOf` gives a property's value and type for the row. */
export function treeMatches(
  tree: FilterGroup,
  valueOf: (propertyId: string) => { type: PropertyType; value: CellValue } | undefined,
): boolean {
  const test = (node: FilterNode): boolean => {
    if (isGroup(node)) return treeMatches(node, valueOf);
    const cell = valueOf(node.property_id);
    // A rule about a property that's gone doesn't hide anything.
    return cell ? ruleMatches(node, cell.type, cell.value) : true;
  };
  const active = tree.rules.filter(isActive);
  if (!active.length) return true;
  return tree.conjunction === "or" ? active.some(test) : active.every(test);
}

/* ---------- In words ---------- */

/** "Type is Task or Type is Issue / Blocker", with groups in brackets. */
export function describeFilter(tree: FilterGroup, nameOf: (propertyId: string) => string): string {
  const part = (node: FilterNode): string => {
    if (isGroup(node)) return `(${describeFilter(node, nameOf)})`;
    const label = node.operator.replace(/_/g, " ");
    return `${nameOf(node.property_id)} ${label}${takesValue(node.operator) ? ` ${node.value}` : ""}`;
  };
  return tree.rules.map(part).join(` ${tree.conjunction} `);
}

/* ---------- New rows ---------- */

/**
 * The values a new row starts with in a filtered view, so it belongs there (as in Notion):
 * what an "is" rule names (a choice, text, a number, a date, checked or not), and what a
 * "contains" rule names for lists and relations. Only rules that must all hold count: under
 * Or, no single value is the one meant. Rules like "is not" or "greater than" don't name a
 * value, so they leave it as it is.
 */
export function valuesForFilter(
  tree: FilterGroup,
  properties: { id: string; type: PropertyType }[],
): Record<string, CellValue> {
  const values: Record<string, CellValue> = {};
  const walk = (group: FilterGroup) => {
    if (group.conjunction === "or" && group.rules.length > 1) return;
    for (const node of group.rules) {
      if (isGroup(node)) {
        walk(node);
        continue;
      }
      const property = properties.find((p) => p.id === node.property_id);
      if (!property || !isFinished(node)) continue;
      const value = node.value;
      switch (property.type) {
        case "select":
        case "status":
        case "text":
        case "url":
        case "email":
        case "phone":
          if (node.operator === "equals") values[property.id] = value;
          break;
        case "title":
          // The title is what people type; a filter's word isn't a name for the row.
          break;
        case "number":
        case "currency":
          if (node.operator === "equals" && Number.isFinite(Number(value))) values[property.id] = Number(value);
          break;
        case "checkbox":
          values[property.id] = value === "true";
          break;
        case "date":
        case "datetime":
          if (["equals", "on_or_before", "on_or_after"].includes(node.operator))
            values[property.id] = value.slice(0, 10);
          break;
        case "multi_select":
        case "relation":
          if (node.operator === "contains" || node.operator === "equals") {
            const list = Array.isArray(values[property.id]) ? (values[property.id] as string[]) : [];
            if (!list.includes(value)) values[property.id] = [...list, value];
          }
          break;
      }
    }
  };
  walk(tree);
  return values;
}
