/**
 * Tools that let an AI agent change what's already in a workspace: a page's title, icon,
 * description and text; a database's name, columns (relations, formulas and rollups too),
 * rows and views (filters, sorts, visible columns, board grouping); a playbook's steps; and
 * moving pages to the Trash. They need a key or connection allowed to "edit".
 *
 * Each tool plans the change here from the workspace as the agent sees it (pure, so tests
 * share it), and the database applies it in one transaction through `agent_update`, which
 * checks the key and that everything is in its workspace. Safety rules:
 * - A page's text is only replaced if it hasn't changed since it was read (no lost edits).
 * - Embedded blocks (subpages, databases, playbook steps) can't be removed or added by a
 *   text edit; playbooks change through update_playbook, which checks them like the builder.
 * - Nothing is deleted for good: trash_page moves pages to the Trash, where they can be restored.
 */
import {
  AGENT_PROPERTY_TYPES,
  MAX_PROPERTIES,
  MAX_RECORDS,
  TEXT_MAX,
  TITLE_MAX,
  buildPlaybook,
  capital,
  cell,
  list,
  plainMarkdown,
  record,
  text,
  whenToUseLine,
} from "./agent-writes";
import { ToolError, describeView, type ToolDefinition, type ToolResult } from "./agent-tools";
import { agentIcon, iconProp } from "./agent-icons";
import { evaluateFormula, renameProperty } from "./database";
import { serializePlaybook, parsePlaybook } from "./playbook-model";
import { parseProcedure } from "./runner";
import { runsOf } from "./runs";
import { descendants } from "./tree";
import type {
  CellValue,
  Database,
  DatabaseView,
  Page,
  Property,
  PropertyType,
  ViewFilter,
  WorkspaceState,
} from "./types";

/** What `agent_update` applies. */
export interface Edit {
  pages: { id: string; title?: string; description?: string; icon?: string; trash?: boolean }[];
  documents: { page_id: string; markdown: string; expected_updated_at: string | null }[];
  databases: { id: string; name?: string; open_mode?: Database["open_mode"] }[];
  property_configs: { id: string; config: Property["config"] }[];
  property_names: { id: string; name: string }[];
  new_properties: Omit<Property, never>[];
  /** Changes to a database's own views (only what's sent changes). */
  views: ({ id: string } & Partial<Omit<DatabaseView, "id" | "database_id" | "placement">>)[];
  new_views: DatabaseView[];
  new_pages: { id: string; parent_id: string; title: string; position: number }[];
  new_documents: { page_id: string; markdown: string }[];
  new_records: { id: string; database_id: string; page_id: string; position: number }[];
  values: { record_id: string; property_id: string; value: CellValue }[];
}
export interface PlannedEdit {
  edit: Edit;
  result: ToolResult;
  /** The page people open to see the change. */
  pageId: string;
}

const EDITS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const MAX_REPLACEMENTS = 50;

/** Column types an agent can add; relations, formulas and rollups need a little more. */
const NEW_PROPERTY_TYPES = [...AGENT_PROPERTY_TYPES, "relation", "formula", "rollup"] as const;
type NewPropertyType = (typeof NEW_PROPERTY_TYPES)[number];
const AGGREGATIONS = ["count", "sum", "average", "min", "max", "values"] as const;

const pageIdProp = {
  type: "string",
  description: "The page's id (from search_workspace, read_page or query_database).",
};

export const EDIT_TOOLS: ToolDefinition[] = [
  {
    name: "update_page",
    title: "Edit a page",
    description:
      "Change an existing page: its title, icon, description, or its text (Markdown). For the text, either replace exact passages " +
      "(`replace`: each `find` must appear exactly once in the page's text as read_page shows it), add to the end (`append`), or " +
      "rewrite all of it (`content`; only for pages without embedded subpages or databases). Embedded blocks shown like " +
      "[Page: …] or [Database: …] are kept as they are. Works for database rows too (their page text); use update_database " +
      "for a row's properties and update_playbook for a playbook's steps. Read the page first.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: pageIdProp,
        title: { type: "string", maxLength: TITLE_MAX },
        icon: iconProp,
        description: { type: "string", maxLength: 2000, description: "The line shown under the title." },
        replace: {
          type: "array",
          maxItems: MAX_REPLACEMENTS,
          description: "Exact replacements, applied in order.",
          items: {
            type: "object",
            properties: { find: { type: "string" }, replace_with: { type: "string" } },
            required: ["find", "replace_with"],
            additionalProperties: false,
          },
        },
        append: { type: "string", maxLength: TEXT_MAX, description: "Markdown added at the end." },
        content: { type: "string", maxLength: TEXT_MAX, description: "The page's whole new text, in Markdown." },
      },
      required: ["page_id"],
      additionalProperties: false,
    },
    annotations: EDITS,
  },
  {
    name: "update_database",
    title: "Edit a database",
    description:
      "Change an existing database: rename it, set its icon or description, choose how its rows open, add properties (columns), " +
      "rename columns or add choices to them, add rows, or change rows' values. Rows are named by their id or page id (from " +
      "query_database); values are keyed by property name, as in create_database, and null clears a value. Choices not listed " +
      "yet are added to select, multi_select and status columns.\n" +
      "Relations link rows of two databases: add a property of type relation with related_database. It shows on both " +
      "databases unless two_way is false (the other side's column is named after this database unless related_property_name " +
      "says otherwise). Set a relation like any value, with the linked rows' titles, ids or page ids (a list, or one for " +
      'limit one); both sides stay in sync. Formulas take an expression like prop("Price") * prop("Quantity"); rollups ' +
      "summarize a property of the rows linked through a relation. Use update_database_view for filters, sorts and columns " +
      "shown, and trash_page with a row's page id to remove a row.",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "The database's id, its page's id, or its exact name." },
        title: { type: "string", maxLength: TITLE_MAX, description: "A new name." },
        icon: iconProp,
        description: { type: "string", maxLength: 2000 },
        rows_open_as: {
          type: "string",
          enum: ["side_panel", "full_page"],
          description: "How its rows open when clicked (on phones they always open as a full page).",
        },
        add_properties: {
          type: "array",
          maxItems: MAX_PROPERTIES,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: [...NEW_PROPERTY_TYPES] },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Choices for select, multi_select and status.",
              },
              related_database: {
                type: "string",
                description: "For a relation: the database it links to (id, page id or exact name; may be this one).",
              },
              limit: {
                type: "string",
                enum: ["one", "many"],
                description: "For a relation: link one row or any number (default many).",
              },
              two_way: {
                type: "boolean",
                description: "For a relation: also show it as a column on the related database (default true).",
              },
              related_property_name: {
                type: "string",
                description:
                  "For a two-way relation: the column's name on the related database (default this database's name).",
              },
              expression: {
                type: "string",
                description: 'For a formula, e.g. prop("Rent") * 12 or if(prop("Paid"), "Yes", "No").',
              },
              relation: {
                type: "string",
                description: "For a rollup: the relation column (in this database) to follow.",
              },
              property: { type: "string", description: "For a rollup: the property of the linked rows to summarize." },
              calculate: {
                type: "string",
                enum: [...AGGREGATIONS],
                description: "For a rollup (default count).",
              },
            },
            required: ["name", "type"],
            additionalProperties: false,
          },
        },
        update_properties: {
          type: "array",
          maxItems: MAX_PROPERTIES,
          description: "Change existing columns.",
          items: {
            type: "object",
            properties: {
              property: { type: "string", description: "The column's current name." },
              name: { type: "string", description: "A new name (formulas that use it follow)." },
              add_options: {
                type: "array",
                items: { type: "string" },
                description: "New choices for a select, multi_select or status column.",
              },
              limit: { type: "string", enum: ["one", "many"], description: "For a relation." },
            },
            required: ["property"],
            additionalProperties: false,
          },
        },
        add_rows: {
          type: "array",
          maxItems: MAX_RECORDS,
          items: { type: "object" },
          description: "New rows, keyed by property name.",
        },
        update_rows: {
          type: "array",
          maxItems: MAX_RECORDS,
          items: {
            type: "object",
            properties: {
              row_id: { type: "string", description: "The row's id or page id." },
              values: { type: "object", description: "Values to set, keyed by property name." },
            },
            required: ["row_id", "values"],
            additionalProperties: false,
          },
        },
      },
      required: ["database"],
      additionalProperties: false,
    },
    annotations: EDITS,
  },
  {
    name: "update_database_view",
    title: "Customize a database view",
    description:
      "Change how a database is shown, or add a view of it: its layout (table, board or list), filters, sorts, which columns " +
      "show and in what order, and what a board groups by. Leave out view to change the database's first view; set create to " +
      "add a new one (it opens as a tab above the table). Filters, sorts and visible_properties replace what the view had; " +
      "send [] to clear filters or sorts. list_databases shows each database's views.",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "The database's id, its page's id, or its exact name." },
        view: { type: "string", description: "The view's name or id (default: the first view)." },
        create: { type: "boolean", description: "Add a new view (named by name) instead of changing one." },
        name: { type: "string", maxLength: 100, description: "A new name, or the new view's name." },
        layout: { type: "string", enum: ["table", "board", "list"] },
        filters: {
          type: "array",
          maxItems: 20,
          description: "Rows shown must match all of them.",
          items: {
            type: "object",
            properties: {
              property: { type: "string", description: "Property name." },
              operator: {
                type: "string",
                enum: ["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty"],
              },
              value: { type: ["string", "number", "boolean"] },
            },
            required: ["property", "operator"],
            additionalProperties: false,
          },
        },
        sorts: {
          type: "array",
          maxItems: 10,
          description: "In order of importance.",
          items: {
            type: "object",
            properties: {
              property: { type: "string" },
              direction: { type: "string", enum: ["ascending", "descending"] },
            },
            required: ["property"],
            additionalProperties: false,
          },
        },
        visible_properties: {
          type: "array",
          items: { type: "string" },
          description: "The columns to show, in order (the title column always shows, first); the rest are hidden.",
        },
        group_by: { type: "string", description: "For a board: the select or status property its columns come from." },
      },
      required: ["database"],
      additionalProperties: false,
    },
    annotations: EDITS,
  },
  {
    name: "update_playbook",
    title: "Edit a playbook",
    description:
      "Rewrite an existing playbook's inputs, guidelines and sections of steps (the same shape as create_playbook), and optionally " +
      "its title and when_to_use. The new version replaces the steps and is checked like a new one: problems come back as an " +
      "error to fix. Read the playbook first (read_page) and send it whole, changed where needed. Not possible while a run of it " +
      "is in progress.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: pageIdProp,
        title: { type: "string", maxLength: TITLE_MAX },
        when_to_use: { type: "string", maxLength: 500 },
        inputs: { type: "array", items: { type: "object" }, description: "As in create_playbook." },
        guidelines: { type: "array", items: { type: "string" } },
        sections: { type: "array", items: { type: "object" }, description: "As in create_playbook." },
      },
      required: ["page_id", "sections"],
      additionalProperties: false,
    },
    annotations: EDITS,
  },
  {
    name: "trash_page",
    title: "Move a page to the Trash",
    description:
      "Move a page, database, playbook or database row (by its page id) to the Trash, with the pages inside it. People can restore " +
      "it from the Trash in Slate. Only do this when the user asked to remove it.",
    inputSchema: {
      type: "object",
      properties: { page_id: pageIdProp },
      required: ["page_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

export const isEditTool = (name: string) => EDIT_TOOLS.some((tool) => tool.name === name);

/* ---------- Shared ---------- */

const emptyEdit = (): Edit => ({
  pages: [],
  documents: [],
  databases: [],
  property_configs: [],
  property_names: [],
  new_properties: [],
  views: [],
  new_views: [],
  new_pages: [],
  new_documents: [],
  new_records: [],
  values: [],
});

/** Lines that are app structure (embeds, playbook steps): text edits must leave them be. */
const STRUCTURE = /^\s*:::slate(-node)?\s/;
const structureOf = (markdown: string) => markdown.split("\n").filter((line) => STRUCTURE.test(line));

function livePage(state: WorkspaceState, raw: unknown): Page {
  const id = typeof raw === "string" ? raw.trim() : "";
  const page = state.pages.find((p) => p.id === id && !p.deleted_at);
  if (!page) throw new ToolError(`There's no page with the id “${id}”. Use search_workspace to find one.`);
  return page;
}
const documentOf = (state: WorkspaceState, pageId: string) => state.documents.find((d) => d.page_id === pageId);
const isPlaybook = (state: WorkspaceState, pageId: string) => {
  const procedure = parseProcedure(documentOf(state, pageId)?.markdown || "");
  return procedure.steps.length > 0 || procedure.params.length > 0;
};

/* ---------- update_page ---------- */

function updatePage(state: WorkspaceState, args: Record<string, unknown>): PlannedEdit {
  const page = livePage(state, args.page_id);
  const edit = emptyEdit();
  const changes: string[] = [];
  const title = args.title === undefined ? undefined : text(args.title, "a title", TITLE_MAX, true);
  const description = args.description === undefined ? undefined : text(args.description, "the description", 2000);
  const icon = args.icon === undefined ? undefined : agentIcon(args.icon);
  if (title !== undefined || description !== undefined || icon !== undefined) {
    edit.pages.push({
      id: page.id,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
    });
    if (title !== undefined) changes.push("title");
    if (icon !== undefined) changes.push(icon ? "icon" : "icon removed");
    if (description !== undefined) changes.push("description");
  }
  // A database's name follows its page's title (the sidebar and its views show both).
  if (title !== undefined && page.kind === "database") {
    const database = state.databases.find((d) => d.page_id === page.id);
    if (database) edit.databases.push({ id: database.id, name: title });
  }
  // A row's title is also its title column.
  const row = state.records.find((r) => r.page_id === page.id);
  if (title !== undefined && row) {
    const titleProperty = state.properties.find((p) => p.database_id === row.database_id && p.type === "title");
    if (titleProperty) edit.values.push({ record_id: row.id, property_id: titleProperty.id, value: title });
  }

  const wantsText = args.content !== undefined || args.append !== undefined || args.replace !== undefined;
  if (wantsText) {
    if (page.kind === "database")
      throw new ToolError(
        `“${page.title}” is a database; its text can't be edited. Use update_database for its rows and columns.`,
      );
    if (isPlaybook(state, page.id))
      throw new ToolError(`“${page.title}” is a playbook; change it with update_playbook so its steps stay valid.`);
    const document = documentOf(state, page.id);
    const before = document?.markdown || "";
    let after = before;
    if (args.content !== undefined) {
      if (args.append !== undefined || args.replace !== undefined)
        throw new ToolError("Send content on its own, or use replace and append.");
      if (structureOf(before).length)
        throw new ToolError(
          `“${page.title}” has embedded subpages or databases, which rewriting it would remove. Use replace for the passages to change, or append.`,
        );
      after = plainMarkdown(text(args.content, "the content", TEXT_MAX));
      after = after ? `${after}\n` : "";
      changes.push("text");
    }
    const replacements = list(args.replace, "replace");
    if (replacements.length > MAX_REPLACEMENTS)
      throw new ToolError(`At most ${MAX_REPLACEMENTS} replacements at once.`);
    replacements.forEach((raw, index) => {
      const item = record(raw, "replace");
      if (typeof item.find !== "string" || !item.find)
        throw new ToolError(`Replacement ${index + 1} needs the exact text to find.`);
      if (typeof item.replace_with !== "string")
        throw new ToolError(`Replacement ${index + 1} needs replace_with (text; empty removes it).`);
      const found = after.split(item.find).length - 1;
      if (found === 0)
        throw new ToolError(
          `Replacement ${index + 1}: “${item.find.slice(0, 80)}” isn't in the page's text. Read the page again and copy the passage exactly.`,
        );
      if (found > 1)
        throw new ToolError(
          `Replacement ${index + 1}: “${item.find.slice(0, 80)}” appears ${found} times; include more around it so it's unique.`,
        );
      after = after.replace(item.find, () => item.replace_with as string);
    });
    if (replacements.length) changes.push(`${replacements.length} passage${replacements.length === 1 ? "" : "s"}`);
    if (args.append !== undefined) {
      const addition = plainMarkdown(text(args.append, "the text to append", TEXT_MAX));
      if (addition) after = after.trim() ? `${after.replace(/\s+$/, "")}\n\n${addition}\n` : `${addition}\n`;
      changes.push("added text");
    }
    if (structureOf(after).join("\n") !== structureOf(before).join("\n"))
      throw new ToolError(
        "That change would add or remove an embedded block (a subpage, database or playbook step). Change only the text around them.",
      );
    if (after.length > TEXT_MAX * 2) throw new ToolError("The page would be too long.");
    if (after !== before)
      edit.documents.push({ page_id: page.id, markdown: after, expected_updated_at: document?.updated_at ?? null });
  }
  if (!edit.pages.length && !edit.documents.length)
    throw new ToolError("Nothing to change: send a title, icon, description, replace, append or content.");
  return {
    edit,
    pageId: page.id,
    result: {
      data: { page_id: page.id, changed: changes },
      text: `Updated “${title ?? page.title}”: ${changes.join(", ")}.`,
    },
  };
}

/* ---------- update_database ---------- */

function findDatabase(state: WorkspaceState, raw: unknown) {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) throw new ToolError("Name the database: its id, its page's id, or its exact name.");
  const live = state.databases.filter((d) => !state.pages.find((p) => p.id === d.page_id)?.deleted_at);
  const database =
    live.find((d) => d.id === key || d.page_id === key) ??
    (() => {
      const named = live.filter((d) => d.name.toLowerCase() === key.toLowerCase());
      if (named.length > 1)
        throw new ToolError(`More than one database is called “${key}”; use its id (from list_databases).`);
      return named[0];
    })();
  if (!database) throw new ToolError(`There's no database “${key}”. Use list_databases to see them.`);
  return database;
}

const CHOICE_TYPES: PropertyType[] = ["select", "multi_select", "status"];
const COMPUTED: PropertyType[] = ["rollup", "formula", "created_time", "updated_time"];
const asIds = (value: CellValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const isTrashed = (state: WorkspaceState, pageId: string) => !!state.pages.find((p) => p.id === pageId)?.deleted_at;
const limitArg = (raw: unknown, name: string): 1 | undefined => {
  if (raw === undefined || raw === "many") return undefined;
  if (raw === "one") return 1;
  throw new ToolError(`The limit for “${name}” must be "one" or "many".`);
};

function updateDatabase(state: WorkspaceState, args: Record<string, unknown>, newId: () => string): PlannedEdit {
  const database = findDatabase(state, args.database);
  const page = state.pages.find((p) => p.id === database.page_id)!;
  const edit = emptyEdit();
  const changes: string[] = [];

  const title = args.title === undefined ? undefined : text(args.title, "a name", TITLE_MAX, true);
  const description = args.description === undefined ? undefined : text(args.description, "the description", 2000);
  const icon = args.icon === undefined ? undefined : agentIcon(args.icon);
  if (title !== undefined || description !== undefined || icon !== undefined) {
    edit.pages.push({
      id: page.id,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(icon !== undefined ? { icon } : {}),
    });
    if (title !== undefined) changes.push("renamed");
    if (icon !== undefined) changes.push(icon ? "icon" : "icon removed");
    if (description !== undefined) changes.push("description");
  }
  let openMode: Database["open_mode"];
  if (args.rows_open_as !== undefined) {
    if (args.rows_open_as !== "side_panel" && args.rows_open_as !== "full_page")
      throw new ToolError('rows_open_as must be "side_panel" or "full_page".');
    openMode = args.rows_open_as === "full_page" ? "page" : "peek";
    changes.push(`rows open as a ${args.rows_open_as === "full_page" ? "full page" : "side panel"}`);
  }
  if (title !== undefined || openMode)
    edit.databases.push({
      id: database.id,
      ...(title !== undefined ? { name: title } : {}),
      ...(openMode ? { open_mode: openMode } : {}),
    });

  // Columns as they'll be (this database's, and other databases' that get a relation's
  // other side), copied so changes can be compared with what was there.
  const copy = (p: Property): Property => ({
    ...p,
    config: { ...p.config, ...(p.config.options ? { options: [...p.config.options] } : {}) },
  });
  let all: Property[] = state.properties.map(copy);
  const original = new Map(state.properties.map((p) => [p.id, { name: p.name, config: JSON.stringify(p.config) }]));
  const columnsOf = (databaseId: string) =>
    all.filter((p) => p.database_id === databaseId && !p.config.system).sort((a, b) => a.position - b.position);
  const columnNamed = (databaseId: string, name: unknown, what: string) => {
    const key = typeof name === "string" ? name.trim().toLowerCase() : "";
    const found = columnsOf(databaseId).find((p) => p.name.toLowerCase() === key);
    if (!found)
      throw new ToolError(
        `${capital(what)}: there's no property “${String(name ?? "")}”. The properties are: ${columnsOf(databaseId)
          .map((p) => p.name)
          .join(", ")}.`,
      );
    return found;
  };
  const nameOf = (id: string) => state.databases.find((d) => d.id === id)?.name || "Untitled";

  // Changes to existing columns.
  const updated = list(args.update_properties, "update_properties");
  updated.forEach((raw, index) => {
    const item = record(raw, "update_properties");
    const property = columnNamed(database.id, item.property, `update_properties item ${index + 1}`);
    if (item.name !== undefined) {
      const name = text(item.name, `a new name for “${property.name}”`, 100, true);
      if (columnsOf(database.id).some((p) => p.id !== property.id && p.name.toLowerCase() === name.toLowerCase()))
        throw new ToolError(`There's already a property called “${name}”.`);
      // Formulas that use the old name follow it.
      all = renameProperty({ ...state, properties: all }, property.id, name).properties;
    }
    const current = all.find((p) => p.id === property.id)!;
    if (item.add_options !== undefined) {
      if (!CHOICE_TYPES.includes(current.type))
        throw new ToolError(
          `“${current.name}” is a ${current.type} property; only select, multi_select and status have choices.`,
        );
      const options = (current.config.options ||= []);
      for (const option of list(item.add_options, `the options for “${current.name}”`)) {
        const choice = String(option).trim();
        if (choice && !options.includes(choice)) options.push(choice);
      }
    }
    if (item.limit !== undefined) {
      if (current.type !== "relation")
        throw new ToolError(`“${current.name}” isn't a relation; only relations have a limit.`);
      const limit = limitArg(item.limit, current.name);
      if (limit) current.config.limit = limit;
      else delete current.config.limit;
    }
  });
  if (updated.length) changes.push(`${updated.length} propert${updated.length === 1 ? "y" : "ies"} changed`);

  // New columns.
  const added = list(args.add_properties, "add_properties");
  const formulas: Property[] = [];
  added.forEach((raw, index) => {
    const column = record(raw, "add_properties");
    const name = text(column.name, `a name for new property ${index + 1}`, 100, true);
    const type = column.type as NewPropertyType;
    if (!NEW_PROPERTY_TYPES.includes(type))
      throw new ToolError(`“${name}” needs a type: one of ${NEW_PROPERTY_TYPES.join(", ")}.`);
    if (columnsOf(database.id).some((p) => p.name.toLowerCase() === name.toLowerCase()))
      throw new ToolError(`There's already a property called “${name}”.`);
    const id = newId();
    let config: Property["config"] = {};
    let otherSide: Property | undefined;
    if (CHOICE_TYPES.includes(type)) {
      const options = list(column.options, `the options for “${name}”`)
        .map((o) => String(o).trim())
        .filter(Boolean);
      config = { options: [...new Set(options)] };
    } else if (type === "relation") {
      if (column.related_database === undefined)
        throw new ToolError(`The relation “${name}” needs related_database: the database it links to.`);
      const target = findDatabase(state, column.related_database);
      const limit = limitArg(column.limit, name);
      config = { related_database_id: target.id, ...(limit ? { limit } : {}) };
      if (column.two_way !== false && target.id !== database.id) {
        const base =
          text(column.related_property_name, `related_property_name for “${name}”`, 100) ||
          title ||
          database.name ||
          "Related";
        const taken = (n: string) => columnsOf(target.id).some((p) => p.name.toLowerCase() === n.toLowerCase());
        let otherName = base;
        for (let n = 2; taken(otherName); n++) otherName = `${base} ${n}`;
        const other: Property = {
          id: newId(),
          database_id: target.id,
          name: otherName,
          type: "relation",
          position: Math.max(0, ...columnsOf(target.id).map((p) => p.position)) + 1,
          width: 250,
          config: { related_database_id: database.id, reciprocal_property_id: id },
        };
        config.reciprocal_property_id = other.id;
        otherSide = other;
      }
    } else if (type === "formula") {
      config = { expression: text(column.expression, `an expression for the formula “${name}”`, 2000, true) };
    } else if (type === "rollup") {
      const relation = columnNamed(database.id, column.relation, `The rollup “${name}”`);
      if (relation.type !== "relation")
        throw new ToolError(
          `The rollup “${name}” needs relation: a relation column, and “${relation.name}” is a ${relation.type}.`,
        );
      const target = relation.config.related_database_id || "";
      const summarized = columnNamed(target, column.property, `The rollup “${name}” (in ${nameOf(target)})`);
      const aggregation = (column.calculate ?? "count") as (typeof AGGREGATIONS)[number];
      if (!AGGREGATIONS.includes(aggregation))
        throw new ToolError(`The rollup “${name}” can calculate: ${AGGREGATIONS.join(", ")}.`);
      config = { relation_property_id: relation.id, rollup_property_id: summarized.id, aggregation };
    }
    const property: Property = {
      id,
      database_id: database.id,
      name,
      type,
      position: Math.max(0, ...columnsOf(database.id).map((p) => p.position)) + 1,
      width: type === "relation" ? 250 : type === "status" || type === "checkbox" ? 160 : 200,
      config,
    };
    all.push(property, ...(otherSide ? [otherSide] : []));
    edit.new_properties.push(property, ...(otherSide ? [otherSide] : []));
    if (type === "formula") formulas.push(property);
  });
  // Formulas are checked once every column exists (they may use one added after them).
  for (const formula of formulas)
    try {
      evaluateFormula(
        formula.config.expression || "",
        Object.fromEntries(columnsOf(database.id).map((p) => [p.name, null])),
      );
    } catch (error) {
      throw new ToolError(
        `The formula “${formula.name}” doesn't work: ${error instanceof Error ? error.message : "check it"}. Use prop("Name") for a property's value.`,
      );
    }
  if (columnsOf(database.id).length > 60) throw new ToolError("That would give the database too many properties.");
  if (added.length) changes.push(`${added.length} new propert${added.length === 1 ? "y" : "ies"}`);
  const twoWay = edit.new_properties.filter((p) => p.database_id !== database.id);
  if (twoWay.length)
    changes.push(
      `${twoWay.map((p) => `“${p.name}” added to ${nameOf(p.database_id)}`).join(", ")} (the other side of the relation)`,
    );

  // Cell values: one per row and column, so a relation's other side can be kept in step.
  const values = new Map<string, { record_id: string; property_id: string; value: CellValue }>();
  const valueOf = (recordId: string, propertyId: string): CellValue | undefined =>
    values.has(`${recordId} ${propertyId}`)
      ? values.get(`${recordId} ${propertyId}`)!.value
      : state.records.find((r) => r.id === recordId)?.values[propertyId];
  const setValue = (recordId: string, propertyId: string, value: CellValue) =>
    values.set(`${recordId} ${propertyId}`, { record_id: recordId, property_id: propertyId, value });
  const otherSide = (property: Property) => {
    const candidate = all.find((p) => p.id === property.config.reciprocal_property_id);
    return candidate?.type === "relation" &&
      candidate.database_id === property.config.related_database_id &&
      candidate.config.related_database_id === property.database_id
      ? candidate
      : undefined;
  };
  /** Links a row to rows of the related database, and each of those back to it. */
  const setRelation = (recordId: string, property: Property, ids: string[]) => {
    const before = asIds(valueOf(recordId, property.id));
    setValue(recordId, property.id, ids);
    const other = otherSide(property);
    if (!other) return;
    for (const linked of new Set([...before, ...ids])) {
      const back = asIds(valueOf(linked, other.id)).filter((id) => id !== recordId);
      if (ids.includes(linked)) back.push(recordId);
      setValue(linked, other.id, back);
    }
  };
  /** The rows a relation value names, by title, id or page id. */
  const linkedRows = (property: Property, raw: unknown, where: string): string[] => {
    if (raw === null || raw === undefined || raw === "") return [];
    const items = Array.isArray(raw) ? raw : [raw];
    const targetId = property.config.related_database_id || "";
    const rows = state.records.filter((r) => r.database_id === targetId && !isTrashed(state, r.page_id));
    const titleOf = (pageId: string) => state.pages.find((p) => p.id === pageId)?.title || "Untitled";
    const ids = items.map((item) => {
      if (typeof item !== "string" || !item.trim())
        throw new ToolError(`${capital(where)}: “${property.name}” takes the linked rows' titles or ids.`);
      const key = item.trim();
      const exact = rows.find((r) => r.id === key || r.page_id === key);
      if (exact) return exact.id;
      const named = rows.filter((r) => titleOf(r.page_id).toLowerCase() === key.toLowerCase());
      if (named.length > 1)
        throw new ToolError(
          `${capital(where)}: more than one row in ${nameOf(targetId)} is called “${key}”; use its id.`,
        );
      if (!named.length)
        throw new ToolError(
          `${capital(where)}: there's no row “${key}” in ${nameOf(targetId)} (what “${property.name}” links to). Use query_database to find it.`,
        );
      return named[0].id;
    });
    const unique = [...new Set(ids)];
    if (property.config.limit === 1 && unique.length > 1)
      throw new ToolError(`${capital(where)}: “${property.name}” links one row, and ${unique.length} were given.`);
    return unique;
  };

  /** Parses a row's values by property name; new choices are added to their column. */
  const parseValues = (raw: unknown, where: string, row: number) => {
    const given = record(raw, where);
    const parsed: { property: Property; value: CellValue }[] = [];
    for (const [key, value] of Object.entries(given)) {
      const property = columnsOf(database.id).find((p) => p.name.toLowerCase() === key.trim().toLowerCase());
      if (!property)
        throw new ToolError(
          `${capital(where)} has “${key}”, which isn't a property. The properties are: ${columnsOf(database.id)
            .map((p) => p.name)
            .join(", ")}.`,
        );
      if (COMPUTED.includes(property.type))
        throw new ToolError(
          `“${property.name}” is a ${property.type} property; Slate works it out, so it can't be set.`,
        );
      if (property.type === "relation") {
        parsed.push({ property, value: linkedRows(property, value, where) });
        continue;
      }
      const result = cell(property.type, value, property.name, row);
      parsed.push({ property, value: result });
      if (result !== null && CHOICE_TYPES.includes(property.type)) {
        const options = (property.config.options ||= []);
        for (const choice of Array.isArray(result) ? result : [String(result)])
          if (!options.includes(choice)) options.push(choice);
      }
    }
    return parsed;
  };
  const apply = (recordId: string, parsed: { property: Property; value: CellValue }[]) => {
    for (const { property, value } of parsed)
      if (property.type === "relation") setRelation(recordId, property, asIds(value));
      else setValue(recordId, property.id, value);
  };

  const newRows = list(args.add_rows, "add_rows");
  if (newRows.length > MAX_RECORDS) throw new ToolError(`At most ${MAX_RECORDS} rows at once.`);
  let rowPosition =
    Math.max(-1, ...state.records.filter((r) => r.database_id === database.id).map((r) => r.position)) + 1;
  newRows.forEach((raw, index) => {
    const parsed = parseValues(raw, `new row ${index + 1}`, index);
    const titleValue = parsed.find((v) => v.property.type === "title")?.value;
    const recordId = newId();
    const pageId = newId();
    edit.new_pages.push({
      id: pageId,
      parent_id: page.id,
      title: typeof titleValue === "string" && titleValue ? titleValue : "Untitled",
      position: rowPosition,
    });
    edit.new_documents.push({ page_id: pageId, markdown: "" });
    edit.new_records.push({ id: recordId, database_id: database.id, page_id: pageId, position: rowPosition++ });
    apply(
      recordId,
      parsed.filter((v) => v.value !== null),
    );
  });
  if (newRows.length) changes.push(`${newRows.length} new row${newRows.length === 1 ? "" : "s"}`);

  const updates = list(args.update_rows, "update_rows");
  if (updates.length > MAX_RECORDS) throw new ToolError(`At most ${MAX_RECORDS} rows at once.`);
  updates.forEach((raw, index) => {
    const item = record(raw, "update_rows");
    const key = typeof item.row_id === "string" ? item.row_id.trim() : "";
    const row = state.records.find((r) => r.database_id === database.id && (r.id === key || r.page_id === key));
    if (!row || isTrashed(state, row.page_id))
      throw new ToolError(
        `Row ${index + 1} of update_rows: there's no row “${key}” in ${database.name}. Use query_database to find its id.`,
      );
    const parsed = parseValues(item.values, `update_rows item ${index + 1}`, index);
    apply(row.id, parsed);
    // The title column is also the row's page title.
    for (const { property, value } of parsed)
      if (property.type === "title")
        edit.pages.push({ id: row.page_id, title: typeof value === "string" && value ? value : "Untitled" });
  });
  if (updates.length) changes.push(`${updates.length} row${updates.length === 1 ? "" : "s"} changed`);
  edit.values = [...values.values()];

  // Existing columns that changed: names, and configs (choices, limits, formulas that follow a rename).
  const fresh = new Set(edit.new_properties.map((p) => p.id));
  for (const column of all) {
    if (fresh.has(column.id)) continue;
    const before = original.get(column.id);
    if (!before) continue;
    if (before.name !== column.name) edit.property_names.push({ id: column.id, name: column.name });
    if (before.config !== JSON.stringify(column.config))
      edit.property_configs.push({ id: column.id, config: column.config });
  }
  // New columns carry their final config (choices added by the rows).
  for (const property of edit.new_properties) property.config = all.find((c) => c.id === property.id)!.config;

  if (!changes.length)
    throw new ToolError(
      "Nothing to change: send a title, icon, description, rows_open_as, add_properties, update_properties, add_rows or update_rows.",
    );
  return {
    edit,
    pageId: page.id,
    result: {
      data: {
        database_id: database.id,
        page_id: page.id,
        changed: changes,
        new_rows: edit.new_records.map((r) => ({ id: r.id, page_id: r.page_id })),
        new_properties: edit.new_properties.map((p) => ({
          name: p.name,
          type: p.type,
          database: nameOf(p.database_id),
        })),
      },
      text: `Updated the database “${title ?? database.name}”: ${changes.join(", ")}.`,
    },
  };
}

/* ---------- update_database_view ---------- */

const FILTER_OPERATORS: ViewFilter["operator"][] = [
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "is_empty",
];

function updateDatabaseView(state: WorkspaceState, args: Record<string, unknown>, newId: () => string): PlannedEdit {
  const database = findDatabase(state, args.database);
  const views = state.views.filter((v) => v.database_id === database.id && !v.placement);
  const properties = state.properties
    .filter((p) => p.database_id === database.id && !p.config.system)
    .sort((a, b) => a.position - b.position);
  const property = (raw: unknown, what: string) => {
    const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const found = properties.find((p) => p.name.toLowerCase() === key);
    if (!found)
      throw new ToolError(
        `${capital(what)}: there's no property “${String(raw ?? "")}”. The properties are: ${properties.map((p) => p.name).join(", ")}.`,
      );
    return found;
  };

  let view: DatabaseView;
  const creating = args.create === true;
  if (creating) {
    const name = text(args.name, "a name for the new view", 100, true);
    if (views.some((v) => v.name.toLowerCase() === name.toLowerCase()))
      throw new ToolError(`${database.name} already has a view called “${name}”.`);
    view = {
      id: newId(),
      database_id: database.id,
      name,
      type: "table",
      filters: [],
      sorts: [],
      hidden_properties: [],
      property_order: [],
    };
  } else {
    const key = typeof args.view === "string" ? args.view.trim() : "";
    const found = key ? views.find((v) => v.id === key || v.name.toLowerCase() === key.toLowerCase()) : views[0];
    if (!found)
      throw new ToolError(
        views.length
          ? `${database.name} has no view “${key}”. Its views are: ${views.map((v) => v.name).join(", ")}.`
          : `${database.name} has no views yet; set create to add one.`,
      );
    view = { ...found };
  }

  const patch: Partial<DatabaseView> = {};
  if (!creating && args.name !== undefined) {
    const name = text(args.name, "a name for the view", 100, true);
    if (views.some((v) => v.id !== view.id && v.name.toLowerCase() === name.toLowerCase()))
      throw new ToolError(`${database.name} already has a view called “${name}”.`);
    patch.name = name;
  }
  if (args.layout !== undefined) {
    if (args.layout !== "table" && args.layout !== "board" && args.layout !== "list")
      throw new ToolError("layout must be table, board or list.");
    patch.type = args.layout;
  }
  if (args.filters !== undefined)
    patch.filters = list(args.filters, "filters").map((raw, index) => {
      const item = record(raw, "filters");
      const target = property(item.property, `filter ${index + 1}`);
      const operator = item.operator as ViewFilter["operator"];
      if (!FILTER_OPERATORS.includes(operator))
        throw new ToolError(`Filter ${index + 1} needs an operator: one of ${FILTER_OPERATORS.join(", ")}.`);
      if (operator !== "is_empty" && (item.value === undefined || item.value === null || item.value === ""))
        throw new ToolError(`Filter ${index + 1} (${target.name} ${operator}) needs a value.`);
      if ((operator === "greater_than" || operator === "less_than") && !Number.isFinite(Number(item.value)))
        throw new ToolError(`Filter ${index + 1}: ${operator.replace("_", " ")} compares numbers.`);
      return { property_id: target.id, operator, value: operator === "is_empty" ? "" : String(item.value) };
    });
  if (args.sorts !== undefined)
    patch.sorts = list(args.sorts, "sorts").map((raw, index) => {
      const item = record(raw, "sorts");
      const target = property(item.property, `sort ${index + 1}`);
      if (item.direction !== undefined && item.direction !== "ascending" && item.direction !== "descending")
        throw new ToolError(`Sort ${index + 1}: direction must be ascending or descending.`);
      return {
        property_id: target.id,
        direction: item.direction === "descending" ? ("desc" as const) : ("asc" as const),
      };
    });
  if (args.visible_properties !== undefined) {
    const shown = [
      ...new Set(
        list(args.visible_properties, "visible_properties").map((name) => property(name, "visible_properties")),
      ),
    ];
    const titleColumn = properties.find((p) => p.type === "title");
    const current = view.property_order?.length ? view.property_order : properties.map((p) => p.id);
    const rest = [
      ...current.filter((id) => properties.some((p) => p.id === id)),
      ...properties.map((p) => p.id).filter((id) => !current.includes(id)),
    ];
    const first = [
      ...(titleColumn ? [titleColumn.id] : []),
      ...shown.map((p) => p.id).filter((id) => id !== titleColumn?.id),
    ];
    patch.property_order = [...first, ...rest.filter((id) => !first.includes(id))];
    patch.hidden_properties = properties.filter((p) => p.type !== "title" && !first.includes(p.id)).map((p) => p.id);
  }
  if (args.group_by !== undefined) {
    const target = property(args.group_by, "group_by");
    if (target.type !== "select" && target.type !== "status")
      throw new ToolError(`A board groups by a select or status property, and “${target.name}” is a ${target.type}.`);
    patch.group_by = target.id;
  }

  const edit = emptyEdit();
  const result = { ...view, ...patch };
  if (creating) edit.new_views.push(result);
  else if (Object.keys(patch).length) edit.views.push({ id: view.id, ...patch });
  else
    throw new ToolError(
      "Nothing to change: send a name, layout, filters, sorts, visible_properties or group_by (or create a view).",
    );
  return {
    edit,
    pageId: database.page_id,
    result: {
      data: { database_id: database.id, view_id: result.id, created: creating },
      text: `${creating ? "Added the view" : "Updated the view"} ${describeView(state, result)} to ${database.name}.`,
    },
  };
}

/* ---------- update_playbook ---------- */

function updatePlaybook(state: WorkspaceState, args: Record<string, unknown>, newId: () => string): PlannedEdit {
  const page = livePage(state, args.page_id);
  if (!isPlaybook(state, page.id))
    throw new ToolError(`“${page.title}” isn't a playbook. Use update_page to change a page.`);
  if (runsOf(state, page.id).runs.some((r) => r.run.status === "running"))
    throw new ToolError(
      `A run of “${page.title}” is in progress. Finish or stop it in Slate first, so it isn't left on steps that changed.`,
    );
  const document = documentOf(state, page.id);
  const { model, sections, tips, stepCount } = buildPlaybook(args, newId, "changed");
  // What the builder keeps that agents don't send: the details table and the notes.
  const previous = parsePlaybook(document?.markdown || "");
  model.details = previous.details;
  model.notes = previous.notes;
  // Embedded blocks in the page (its Runs database, subpages) stay, after the steps.
  const serialized = serializePlaybook(model).replace(/\s+$/, "");
  const kept = structureOf(document?.markdown || "").filter(
    (line) => !/^\s*:::slate-node\s/.test(line) && !serialized.includes(line.trim()),
  );
  const markdown = [serialized, ...kept].join("\n\n") + "\n";

  const edit = emptyEdit();
  const title = args.title === undefined ? undefined : text(args.title, "a title", TITLE_MAX, true);
  const whenToUse =
    args.when_to_use === undefined ? undefined : whenToUseLine(text(args.when_to_use, "when_to_use", 500));
  if (title !== undefined || whenToUse !== undefined)
    edit.pages.push({
      id: page.id,
      ...(title !== undefined ? { title } : {}),
      ...(whenToUse !== undefined ? { description: whenToUse } : {}),
    });
  edit.documents.push({ page_id: page.id, markdown, expected_updated_at: document?.updated_at ?? null });
  return {
    edit,
    pageId: page.id,
    result: {
      data: { page_id: page.id, sections: sections.map((s) => s.title), steps: stepCount, tips },
      text:
        `Updated the playbook “${title ?? page.title}”: ${sections.length} section${sections.length === 1 ? "" : "s"}, ${stepCount} step${stepCount === 1 ? "" : "s"}.` +
        (tips.length ? `\nTips:\n${tips.map((t) => `- ${t}`).join("\n")}` : ""),
    },
  };
}

/* ---------- trash_page ---------- */

function trashPage(state: WorkspaceState, args: Record<string, unknown>): PlannedEdit {
  const page = livePage(state, args.page_id);
  const inside = descendants(state.pages, page.id).filter((id) => !state.pages.find((p) => p.id === id)?.deleted_at);
  const edit = emptyEdit();
  edit.pages.push({ id: page.id, trash: true }, ...inside.map((id) => ({ id, trash: true })));
  return {
    edit,
    pageId: page.id,
    result: {
      data: { page_id: page.id, trashed: 1 + inside.length },
      text: `Moved “${page.title || "Untitled"}”${inside.length ? ` and ${inside.length} page${inside.length === 1 ? "" : "s"} inside it` : ""} to the Trash. It can be restored from the Trash in Slate.`,
    },
  };
}

/** Plans one edit tool. Throws ToolError for a problem the agent can fix. */
export function planEdit(
  state: WorkspaceState,
  name: string,
  args: Record<string, unknown> = {},
  newId: () => string = () => crypto.randomUUID(),
): PlannedEdit {
  switch (name) {
    case "update_page":
      return updatePage(state, args);
    case "update_database":
      return updateDatabase(state, args, newId);
    case "update_database_view":
      return updateDatabaseView(state, args, newId);
    case "update_playbook":
      return updatePlaybook(state, args, newId);
    case "trash_page":
      return trashPage(state, args);
    default:
      throw new ToolError(`There's no tool called “${name}”.`);
  }
}
