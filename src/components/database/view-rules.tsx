"use client";
/**
 * Sorting and filtering a view, as in Notion. Under the toolbar, a pill for the sorts and
 * one for each filter rule ("Status: Done"); once a filter joins rules with Or, or has
 * groups, it's one "3 rules" pill that opens the advanced editor: rows of Where / And / Or,
 * a property, a condition that suits its type and a value, groups of rules, and a "…" menu
 * on each to duplicate, group or remove it. "+ Filter" adds a rule for a property.
 */
import { useState, type Dispatch, type SetStateAction } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  Copy,
  GripVertical,
  ListFilter,
  MoreHorizontal,
  Plus,
  Search,
  SquareStack,
  Trash2,
  X,
} from "lucide-react";
import type { DatabaseView, Property, ViewFilter, WorkspaceState } from "@/lib/types";
import { recordTitle } from "@/lib/database";
import {
  allRules,
  filterTree,
  isGroup,
  newRule,
  operatorsFor,
  retarget,
  storedFilters,
  takesValue,
  type Conjunction,
  type FilterGroup,
  type FilterNode,
} from "@/lib/view-filters";
import { isTouchOnly } from "../keys";

type Sort = DatabaseView["sorts"][number];
/** Which pill's popover is open: a rule (by index), the advanced filter, the sorts, or "+ Filter". */
export type OpenRules =
  { kind: "rule"; index: number } | { kind: "advanced" } | { kind: "sorts" } | { kind: "add" } | null;

interface Shared {
  view: DatabaseView;
  properties: Property[];
  state: WorkspaceState;
  updateView: (patch: Partial<DatabaseView>) => void;
}

/** Whether the filter is only rules that must all match (one pill per rule). */
export const isSimpleFilter = (tree: FilterGroup) => tree.conjunction === "and" && !tree.rules.some(isGroup);

/* ---------- Small parts ---------- */

function Pop({
  open,
  onOpenChange,
  trigger,
  label,
  className = "",
  handsOff = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  label: string;
  className?: string;
  /**
   * It closes by opening another popover (a property picked opens its new rule): focus
   * mustn't come back to its button, or the new one sees it leave and closes too.
   */
  handsOff?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={`db-menu db-rules-menu ${className}`}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          onCloseAutoFocus={(event) => {
            if (handsOff) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (isTouchOnly()) return;
            (event.currentTarget as HTMLElement)
              ?.querySelector<HTMLElement>("[data-autofocus], input:not([type=checkbox])")
              ?.focus();
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A compact dropdown (native, so it suits phones and keyboards). */
function Choice<T extends string>({
  value,
  options,
  label,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <span className={`db-rule-choice ${className}`}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden />
    </span>
  );
}

/** The value of a rule, in the form its property takes. */
function RuleValue({
  rule,
  property,
  state,
  onChange,
}: {
  rule: ViewFilter;
  property?: Property;
  state: WorkspaceState;
  onChange: (value: string) => void;
}) {
  if (!property || !takesValue(rule.operator)) return null;
  const choices = (options: { value: string; label: string }[], placeholder: string) => (
    <Choice
      label="Filter value"
      value={rule.value}
      className={rule.value ? "" : "is-placeholder"}
      options={[{ value: "", label: placeholder }, ...options]}
      onChange={onChange}
    />
  );
  switch (property.type) {
    case "select":
    case "status":
    case "multi_select": {
      const options =
        property.config.options ?? (property.type === "status" ? ["Not started", "In progress", "Done"] : []);
      return choices(
        options.map((o) => ({ value: o, label: o })),
        "Select an option…",
      );
    }
    case "checkbox":
      return (
        <Choice
          label="Filter value"
          value={rule.value === "false" ? "false" : "true"}
          options={[
            { value: "true", label: "Checked" },
            { value: "false", label: "Unchecked" },
          ]}
          onChange={onChange}
        />
      );
    case "relation": {
      const rows = state.records.filter(
        (r) =>
          r.database_id === property.config.related_database_id &&
          !state.pages.find((p) => p.id === r.page_id)?.deleted_at,
      );
      return choices(
        rows.map((r) => ({ value: r.id, label: recordTitle(r, state) || "Untitled" })),
        "Choose a record…",
      );
    }
    case "date":
    case "datetime":
    case "created_time":
    case "updated_time":
      return (
        <input
          className="db-rule-input"
          type="date"
          aria-label="Filter value"
          value={rule.value.slice(0, 10)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "currency":
      return (
        <input
          className="db-rule-input"
          type="number"
          inputMode="decimal"
          aria-label="Filter value"
          placeholder="Value"
          value={rule.value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          className="db-rule-input"
          aria-label="Filter value"
          placeholder="Value"
          value={rule.value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** A row's "…": what can be done to a rule or group. */
function RowMenu({
  label,
  actions,
}: {
  label: string;
  actions: { label: string; icon: React.ReactNode; run: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      label={label}
      className="db-rules-row-menu"
      trigger={
        <button type="button" className="db-icon-button db-rule-more" aria-label={label} title="More">
          <MoreHorizontal size={16} />
        </button>
      }
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={`db-menu-action ${action.danger ? "danger" : ""}`}
          onClick={() => {
            setOpen(false);
            action.run();
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </Pop>
  );
}

/** "Where" for the first row, an And/Or choice on the second, the same word after that. */
function Joiner({
  index,
  conjunction,
  onChange,
}: {
  index: number;
  conjunction: Conjunction;
  onChange: (c: Conjunction) => void;
}) {
  if (index === 0) return <span className="db-rule-joiner">Where</span>;
  if (index === 1)
    return (
      <Choice
        label="Match"
        className="db-rule-joiner-choice"
        value={conjunction}
        options={[
          { value: "and", label: "And" },
          { value: "or", label: "Or" },
        ]}
        onChange={onChange}
      />
    );
  return <span className="db-rule-joiner">{conjunction === "and" ? "And" : "Or"}</span>;
}

/** Property, condition and value of one rule. */
function RuleFields({
  rule,
  properties,
  state,
  onChange,
}: {
  rule: ViewFilter;
  properties: Property[];
  state: WorkspaceState;
  onChange: (rule: ViewFilter) => void;
}) {
  const property = properties.find((p) => p.id === rule.property_id);
  const operators = operatorsFor(property?.type ?? "text");
  return (
    <>
      <Choice
        label="Filter property"
        value={rule.property_id}
        options={properties.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(id) => {
          const next = properties.find((p) => p.id === id);
          if (next) onChange(retarget(rule, next));
        }}
      />
      <Choice
        label="Filter condition"
        value={operators.some((o) => o.value === rule.operator) ? rule.operator : operators[0].value}
        options={operators.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(operator) => onChange({ ...rule, operator, value: takesValue(operator) ? rule.value : "" })}
      />
      <RuleValue rule={rule} property={property} state={state} onChange={(value) => onChange({ ...rule, value })} />
    </>
  );
}

/* ---------- The advanced editor ---------- */

function GroupEditor({
  group,
  depth,
  properties,
  state,
  onChange,
}: {
  group: FilterGroup;
  depth: number;
  properties: Property[];
  state: WorkspaceState;
  onChange: (group: FilterGroup) => void;
}) {
  const setRules = (rules: FilterNode[]) => onChange({ ...group, rules });
  const replace = (index: number, node: FilterNode | null) =>
    setRules(node ? group.rules.map((n, i) => (i === index ? node : n)) : group.rules.filter((_, i) => i !== index));
  const first = properties[0];
  return (
    <div className={`db-rules-group ${depth ? "is-nested" : ""}`}>
      {group.rules.map((node, index) => (
        <div className="db-rule-row" key={index}>
          <Joiner
            index={index}
            conjunction={group.conjunction}
            onChange={(conjunction) => onChange({ ...group, conjunction })}
          />
          {isGroup(node) ? (
            <GroupEditor
              group={node}
              depth={depth + 1}
              properties={properties}
              state={state}
              onChange={(next) => replace(index, next.rules.length ? next : null)}
            />
          ) : (
            <div className="db-rule-fields">
              <RuleFields rule={node} properties={properties} state={state} onChange={(rule) => replace(index, rule)} />
            </div>
          )}
          <RowMenu
            label={isGroup(node) ? "Filter group actions" : "Filter rule actions"}
            actions={[
              {
                label: isGroup(node) ? "Duplicate group" : "Duplicate",
                icon: <Copy size={16} />,
                run: () =>
                  setRules([
                    ...group.rules.slice(0, index + 1),
                    structuredClone(node),
                    ...group.rules.slice(index + 1),
                  ]),
              },
              ...(!isGroup(node) && depth === 0
                ? [
                    {
                      label: "Turn into group",
                      icon: <SquareStack size={16} />,
                      run: () => replace(index, { type: "group" as const, conjunction: "and" as const, rules: [node] }),
                    },
                  ]
                : []),
              {
                label: isGroup(node) ? "Remove group" : "Remove",
                icon: <Trash2 size={16} />,
                danger: true,
                run: () => replace(index, null),
              },
            ]}
          />
        </div>
      ))}
      {first && (
        <div className="db-rules-add">
          <button
            type="button"
            className="db-rules-add-button"
            onClick={() => setRules([...group.rules, newRule(first)])}
          >
            <Plus size={15} />
            Add filter rule
          </button>
          {depth === 0 && (
            <button
              type="button"
              className="db-rules-add-button"
              onClick={() => setRules([...group.rules, { type: "group", conjunction: "and", rules: [newRule(first)] }])}
            >
              <SquareStack size={15} />
              Add filter group
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Sorts ---------- */

function SortEditor({ view, properties, updateView }: Omit<Shared, "state">) {
  const [dragging, setDragging] = useState<number | null>(null);
  const sorts = view.sorts;
  const set = (next: Sort[]) => updateView({ sorts: next });
  const unused = properties.find((p) => !sorts.some((s) => s.property_id === p.id)) ?? properties[0];
  return (
    <div className="db-sorts">
      {sorts.map((sort, index) => (
        <div
          className={`db-sort-row ${dragging === index ? "is-dragging" : ""}`}
          key={`${sort.property_id}-${index}`}
          onDragOver={(e) => {
            if (dragging === null || dragging === index) return;
            e.preventDefault();
            const next = [...sorts];
            const [moved] = next.splice(dragging, 1);
            next.splice(index, 0, moved);
            setDragging(index);
            set(next);
          }}
        >
          <span
            className="db-sort-grip"
            draggable
            title="Drag to reorder"
            aria-hidden
            onDragStart={(e) => {
              setDragging(index);
              e.dataTransfer.effectAllowed = "move";
              const row = e.currentTarget.closest(".db-sort-row");
              if (row) e.dataTransfer.setDragImage(row, 12, 16);
            }}
            onDragEnd={() => setDragging(null)}
          >
            <GripVertical size={14} />
          </span>
          <Choice
            label="Sort property"
            value={sort.property_id}
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(property_id) => set(sorts.map((s, i) => (i === index ? { ...s, property_id } : s)))}
          />
          <Choice
            label="Sort direction"
            value={sort.direction}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            onChange={(direction) => set(sorts.map((s, i) => (i === index ? { ...s, direction } : s)))}
          />
          <button
            type="button"
            className="db-icon-button"
            aria-label="Remove sort"
            title="Remove sort"
            onClick={() => set(sorts.filter((_, i) => i !== index))}
          >
            <X size={15} />
          </button>
        </div>
      ))}
      {unused && (
        <button
          type="button"
          className="db-rules-add-button"
          data-autofocus
          onClick={() => set([...sorts, { property_id: unused.id, direction: "asc" }])}
        >
          <Plus size={15} />
          Add sort
        </button>
      )}
      {sorts.length > 0 && (
        <button type="button" className="db-rules-add-button is-danger" onClick={() => set([])}>
          <Trash2 size={15} />
          Delete sort
        </button>
      )}
    </div>
  );
}

/* ---------- Picking a property ---------- */

function PropertyPicker({
  properties,
  onPick,
  footer,
}: {
  properties: Property[];
  onPick: (property: Property) => void;
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const shown = properties.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="db-rules-picker">
      <label className="db-rules-search">
        <Search size={14} aria-hidden />
        <input
          placeholder="Filter by…"
          aria-label="Find a property"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) onPick(shown[0]);
          }}
        />
      </label>
      <div className="db-options-scroll">
        {shown.map((property) => (
          <button key={property.id} type="button" className="db-menu-action" onClick={() => onPick(property)}>
            <span>{property.name}</span>
          </button>
        ))}
        {!shown.length && <div className="db-menu-hint">No properties match.</div>}
      </div>
      {footer}
    </div>
  );
}

/* ---------- The bar of pills ---------- */

function ruleLabel(rule: ViewFilter, properties: Property[], state: WorkspaceState) {
  const property = properties.find((p) => p.id === rule.property_id);
  const name = property?.name ?? "Property";
  if (!takesValue(rule.operator))
    return `${name}: ${operatorsFor(property?.type ?? "text")
      .find((o) => o.value === rule.operator)
      ?.label.toLowerCase()}`;
  if (!rule.value) return name;
  let value = rule.value;
  if (property?.type === "checkbox") value = rule.value === "false" ? "Unchecked" : "Checked";
  if (property?.type === "relation") {
    const record = state.records.find((r) => r.id === rule.value);
    value = record ? recordTitle(record, state) : "…";
  }
  const negative = ["not_equals", "not_contains"].includes(rule.operator) ? "not " : "";
  return `${name}: ${negative}${value}`;
}

/**
 * The toolbar's Filter and Sort buttons open these too: a property to filter by (which
 * then opens its new pill), or the sorts.
 */
export function ViewRulesBar({
  view,
  properties,
  state,
  updateView,
  open,
  setOpen,
}: Shared & { open: OpenRules; setOpen: Dispatch<SetStateAction<OpenRules>> }) {
  const tree = filterTree(view.filters);
  const simple = isSimpleFilter(tree);
  const ruleCount = allRules(tree).length;
  const setTree = (next: FilterGroup) => updateView({ filters: storedFilters(next) });
  const same = (a: OpenRules, b: Exclude<OpenRules, null>) =>
    !!a && a.kind === b.kind && (b.kind !== "rule" || (a.kind === "rule" && a.index === b.index));
  // Closing only closes this one: a popover that replaced it (a new rule's) stays open.
  const toggle = (what: Exclude<OpenRules, null>) => (value: boolean) =>
    setOpen((current) => (value ? what : same(current, what) ? null : current));
  const isOpen = (what: Exclude<OpenRules, null>) => same(open, what);
  if (!view.sorts.length && !tree.rules.length && open?.kind !== "add") return null;

  const addRule = (property: Property) => {
    const rules = [...tree.rules, newRule(property)];
    setTree({ ...tree, rules });
    setOpen(simple ? { kind: "rule", index: rules.length - 1 } : { kind: "advanced" });
  };
  const sortLabel =
    view.sorts.length === 1
      ? `${properties.find((p) => p.id === view.sorts[0].property_id)?.name ?? "Sort"}`
      : `${view.sorts.length} sorts`;

  return (
    <div className="db-rules-bar" role="toolbar" aria-label="Sorts and filters">
      {view.sorts.length > 0 && (
        <>
          <Pop
            open={isOpen({ kind: "sorts" })}
            onOpenChange={toggle({ kind: "sorts" })}
            label="Sorts"
            trigger={
              <button type="button" className="db-rule-pill is-sort">
                {view.sorts.length === 1 ? (
                  view.sorts[0].direction === "asc" ? (
                    <ArrowUp size={14} />
                  ) : (
                    <ArrowDown size={14} />
                  )
                ) : (
                  <ArrowDownUp size={14} />
                )}
                <span>{sortLabel}</span>
                <ChevronDown size={13} />
              </button>
            }
          >
            <SortEditor view={view} properties={properties} updateView={updateView} />
          </Pop>
          {tree.rules.length > 0 && <span className="db-rules-divider" aria-hidden />}
        </>
      )}
      {simple ? (
        tree.rules.map((node, index) => {
          const rule = node as ViewFilter;
          return (
            <Pop
              key={index}
              open={isOpen({ kind: "rule", index })}
              onOpenChange={toggle({ kind: "rule", index })}
              label="Filter"
              className="db-rules-single"
              trigger={
                <button
                  type="button"
                  className={`db-rule-pill ${takesValue(rule.operator) && !rule.value ? "is-unfinished" : ""}`}
                >
                  <span>{ruleLabel(rule, properties, state)}</span>
                  <ChevronDown size={13} />
                </button>
              }
            >
              <div className="db-rule-fields is-single">
                <RuleFields
                  rule={rule}
                  properties={properties}
                  state={state}
                  onChange={(next) => setTree({ ...tree, rules: tree.rules.map((n, i) => (i === index ? next : n)) })}
                />
                <RowMenu
                  label="Filter rule actions"
                  actions={[
                    {
                      label: "Add to advanced filter",
                      icon: <SquareStack size={16} />,
                      run: () => {
                        setTree({
                          type: "group",
                          conjunction: "and",
                          rules: [{ type: "group", conjunction: "and", rules: tree.rules }],
                        });
                        setOpen({ kind: "advanced" });
                      },
                    },
                    {
                      label: "Delete filter",
                      icon: <Trash2 size={16} />,
                      danger: true,
                      run: () => {
                        setTree({ ...tree, rules: tree.rules.filter((_, i) => i !== index) });
                        setOpen(null);
                      },
                    },
                  ]}
                />
              </div>
            </Pop>
          );
        })
      ) : (
        <Pop
          open={isOpen({ kind: "advanced" })}
          onOpenChange={toggle({ kind: "advanced" })}
          label="Advanced filter"
          className="db-rules-advanced"
          trigger={
            <button type="button" className="db-rule-pill">
              <ListFilter size={14} />
              <span>
                {ruleCount} rule{ruleCount === 1 ? "" : "s"}
              </span>
              <ChevronDown size={13} />
            </button>
          }
        >
          <GroupEditor group={tree} depth={0} properties={properties} state={state} onChange={setTree} />
          <div className="db-menu-divider" />
          <button
            type="button"
            className="db-rules-add-button is-danger"
            onClick={() => {
              setTree({ type: "group", conjunction: "and", rules: [] });
              setOpen(null);
            }}
          >
            <Trash2 size={15} />
            Delete filter
          </button>
        </Pop>
      )}
      <Pop
        open={isOpen({ kind: "add" })}
        onOpenChange={toggle({ kind: "add" })}
        label="Add a filter"
        handsOff
        trigger={
          <button type="button" className="db-rules-add-pill">
            <Plus size={14} />
            Filter
          </button>
        }
      >
        <PropertyPicker
          properties={properties}
          onPick={addRule}
          footer={
            properties[0] && (
              <>
                <div className="db-menu-divider" />
                <button
                  type="button"
                  className="db-menu-action"
                  onClick={() => {
                    // A group of rules among the others: the filter becomes the advanced one.
                    setTree({
                      ...tree,
                      rules: [...tree.rules, { type: "group", conjunction: "and", rules: [newRule(properties[0])] }],
                    });
                    setOpen({ kind: "advanced" });
                  }}
                >
                  <SquareStack size={16} />
                  <span>Add advanced filter</span>
                </button>
              </>
            )
          }
        />
      </Pop>
    </div>
  );
}

/** The toolbar's Sort button: the sorts, or (with none yet) a property to sort by. */
export function SortButton({
  view,
  properties,
  updateView,
  setOpen,
}: Omit<Shared, "state"> & { setOpen: (open: OpenRules) => void }) {
  const [picking, setPicking] = useState(false);
  return (
    <Pop
      open={picking}
      onOpenChange={(value) => {
        if (value && view.sorts.length) {
          // Sorts already show as a pill: open that instead.
          setOpen({ kind: "sorts" });
          return;
        }
        setPicking(value);
      }}
      label="Sort by"
      handsOff
      trigger={
        <button
          className={`db-icon-button ${view.sorts.length ? "is-active" : ""}`}
          title="Sort"
          aria-label="Sort records"
        >
          <ArrowDownUp size={16} />
        </button>
      }
    >
      <PropertyPicker
        properties={properties}
        onPick={(property) => {
          updateView({ sorts: [{ property_id: property.id, direction: "asc" }] });
          setPicking(false);
          setOpen({ kind: "sorts" });
        }}
      />
    </Pop>
  );
}

/** The toolbar's Filter button: a property to filter by. */
export function FilterButton({
  view,
  properties,
  updateView,
  setOpen,
}: Omit<Shared, "state"> & { setOpen: (open: OpenRules) => void }) {
  const [picking, setPicking] = useState(false);
  const tree = filterTree(view.filters);
  const count = allRules(tree).length;
  return (
    <Pop
      open={picking}
      onOpenChange={setPicking}
      label="Filter by"
      handsOff
      trigger={
        <button className={`db-icon-button ${count ? "is-active" : ""}`} title="Filter" aria-label="Filter records">
          <ListFilter size={18} />
          {count > 0 && <span className="db-tool-count">{count}</span>}
        </button>
      }
    >
      <PropertyPicker
        properties={properties}
        onPick={(property) => {
          const simple = isSimpleFilter(tree);
          const rules = [...tree.rules, newRule(property)];
          updateView({ filters: storedFilters({ ...tree, rules }) });
          setPicking(false);
          setOpen(simple ? { kind: "rule", index: rules.length - 1 } : { kind: "advanced" });
        }}
      />
    </Pop>
  );
}

/** "Filter this property" from a column: a new rule for it, opened. */
export function filterProperty(
  view: DatabaseView,
  property: Property,
): { filters: DatabaseView["filters"]; open: OpenRules } {
  const tree = filterTree(view.filters);
  const rules = [...tree.rules, newRule(property)];
  return {
    filters: storedFilters({ ...tree, rules }),
    open: isSimpleFilter(tree) ? { kind: "rule", index: rules.length - 1 } : { kind: "advanced" },
  };
}
