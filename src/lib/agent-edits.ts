/**
 * Tools that let an AI agent change what's already in a workspace: a page's title,
 * description and text; a database's name, columns and rows; a playbook's steps; and moving
 * pages to the Trash. They need a key or connection allowed to "edit".
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
  type AgentPropertyType,
} from "./agent-writes";
import { ToolError, type ToolDefinition, type ToolResult } from "./agent-tools";
import { serializePlaybook, parsePlaybook } from "./playbook-model";
import { parseProcedure } from "./runner";
import { runsOf } from "./runs";
import { descendants } from "./tree";
import type { CellValue, Page, Property, PropertyType, WorkspaceState } from "./types";

/** What `agent_update` applies. */
export interface Edit {
  pages: { id: string; title?: string; description?: string; trash?: boolean }[];
  documents: { page_id: string; markdown: string; expected_updated_at: string | null }[];
  databases: { id: string; name: string }[];
  property_configs: { id: string; config: Property["config"] }[];
  new_properties: Omit<Property, never>[];
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

const pageIdProp = {
  type: "string",
  description: "The page's id (from search_workspace, read_page or query_database).",
};

export const EDIT_TOOLS: ToolDefinition[] = [
  {
    name: "update_page",
    title: "Edit a page",
    description:
      "Change an existing page: its title, its description, or its text (Markdown). For the text, either replace exact passages " +
      "(`replace`: each `find` must appear exactly once in the page's text as read_page shows it), add to the end (`append`), or " +
      "rewrite all of it (`content`; only for pages without embedded subpages or databases). Embedded blocks shown like " +
      "[Page: …] or [Database: …] are kept as they are. Works for database rows too (their page text); use update_database " +
      "for a row's properties and update_playbook for a playbook's steps. Read the page first.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: pageIdProp,
        title: { type: "string", maxLength: TITLE_MAX },
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
      "Change an existing database: rename it, change its description, add properties (columns), add rows, or change rows' values. " +
      "Rows are named by their id or page id (from query_database); values are keyed by property name, as in create_database, and " +
      "null clears a value. Choices not listed yet are added to select, multi_select and status columns. Relation, formula and " +
      "rollup columns can't be set here. Use trash_page with a row's page id to remove a row.",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "The database's id, its page's id, or its exact name." },
        title: { type: "string", maxLength: TITLE_MAX, description: "A new name." },
        description: { type: "string", maxLength: 2000 },
        add_properties: {
          type: "array",
          maxItems: MAX_PROPERTIES,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: [...AGENT_PROPERTY_TYPES] },
              options: { type: "array", items: { type: "string" } },
            },
            required: ["name", "type"],
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
  new_properties: [],
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
  if (title !== undefined || description !== undefined) {
    edit.pages.push({
      id: page.id,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    });
    if (title !== undefined) changes.push("title");
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
    throw new ToolError("Nothing to change: send a title, description, replace, append or content.");
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
const SETTABLE = (type: PropertyType) =>
  !["relation", "rollup", "formula", "created_time", "updated_time"].includes(type);

function updateDatabase(state: WorkspaceState, args: Record<string, unknown>, newId: () => string): PlannedEdit {
  const database = findDatabase(state, args.database);
  const page = state.pages.find((p) => p.id === database.page_id)!;
  const edit = emptyEdit();
  const changes: string[] = [];

  const title = args.title === undefined ? undefined : text(args.title, "a name", TITLE_MAX, true);
  const description = args.description === undefined ? undefined : text(args.description, "the description", 2000);
  if (title !== undefined || description !== undefined) {
    edit.pages.push({
      id: page.id,
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    });
    if (title !== undefined) {
      edit.databases.push({ id: database.id, name: title });
      changes.push("renamed");
    }
    if (description !== undefined) changes.push("description");
  }

  // Columns as they'll be: the current ones (with any new choices) and the new ones.
  const columns: Property[] = state.properties
    .filter((p) => p.database_id === database.id && !p.config.system)
    .map((p) => ({ ...p, config: { ...p.config, ...(p.config.options ? { options: [...p.config.options] } : {}) } }));
  const originalOptions = new Map(columns.map((p) => [p.id, JSON.stringify(p.config.options ?? null)]));
  const added = list(args.add_properties, "add_properties");
  let position = Math.max(0, ...columns.map((p) => p.position)) + 1;
  added.forEach((raw, index) => {
    const column = record(raw, "add_properties");
    const name = text(column.name, `a name for new property ${index + 1}`, 100, true);
    const type = column.type as AgentPropertyType;
    if (!AGENT_PROPERTY_TYPES.includes(type))
      throw new ToolError(`“${name}” needs a type: one of ${AGENT_PROPERTY_TYPES.join(", ")}.`);
    if (columns.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      throw new ToolError(`There's already a property called “${name}”.`);
    const options = list(column.options, `the options for “${name}”`)
      .map((o) => String(o).trim())
      .filter(Boolean);
    const property: Property = {
      id: newId(),
      database_id: database.id,
      name,
      type,
      position: position++,
      width: type === "status" || type === "checkbox" ? 160 : 200,
      config: CHOICE_TYPES.includes(type) ? { options: [...new Set(options)] } : {},
    };
    columns.push(property);
    edit.new_properties.push(property);
  });
  if (columns.length > 60) throw new ToolError("That would give the database too many properties.");
  if (added.length) changes.push(`${added.length} new propert${added.length === 1 ? "y" : "ies"}`);
  const byName = new Map(columns.map((p) => [p.name.toLowerCase(), p]));

  /** Parses a row's values by property name; new choices are added to their column. */
  const parseValues = (raw: unknown, where: string, row: number) => {
    const values = record(raw, where);
    const parsed: { property: Property; value: CellValue }[] = [];
    for (const [key, value] of Object.entries(values)) {
      const property = byName.get(key.trim().toLowerCase());
      if (!property)
        throw new ToolError(
          `${capital(where)} has “${key}”, which isn't a property. The properties are: ${columns.map((p) => p.name).join(", ")}.`,
        );
      if (!SETTABLE(property.type))
        throw new ToolError(`“${property.name}” is a ${property.type} property; it can't be set here.`);
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

  const newRows = list(args.add_rows, "add_rows");
  if (newRows.length > MAX_RECORDS) throw new ToolError(`At most ${MAX_RECORDS} rows at once.`);
  let rowPosition =
    Math.max(-1, ...state.records.filter((r) => r.database_id === database.id).map((r) => r.position)) + 1;
  newRows.forEach((raw, index) => {
    const values = parseValues(raw, `new row ${index + 1}`, index);
    const titleValue = values.find((v) => v.property.type === "title")?.value;
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
    for (const { property, value } of values)
      if (value !== null) edit.values.push({ record_id: recordId, property_id: property.id, value });
  });
  if (newRows.length) changes.push(`${newRows.length} new row${newRows.length === 1 ? "" : "s"}`);

  const updates = list(args.update_rows, "update_rows");
  if (updates.length > MAX_RECORDS) throw new ToolError(`At most ${MAX_RECORDS} rows at once.`);
  updates.forEach((raw, index) => {
    const item = record(raw, "update_rows");
    const key = typeof item.row_id === "string" ? item.row_id.trim() : "";
    const row = state.records.find((r) => r.database_id === database.id && (r.id === key || r.page_id === key));
    if (!row || state.pages.find((p) => p.id === row.page_id)?.deleted_at)
      throw new ToolError(
        `Row ${index + 1} of update_rows: there's no row “${key}” in ${database.name}. Use query_database to find its id.`,
      );
    for (const { property, value } of parseValues(item.values, `update_rows item ${index + 1}`, index)) {
      edit.values.push({ record_id: row.id, property_id: property.id, value });
      // The title column is also the row's page title.
      if (property.type === "title")
        edit.pages.push({ id: row.page_id, title: typeof value === "string" && value ? value : "Untitled" });
    }
  });
  if (updates.length) changes.push(`${updates.length} row${updates.length === 1 ? "" : "s"} changed`);

  for (const column of columns)
    if (
      originalOptions.has(column.id) &&
      JSON.stringify(column.config.options ?? null) !== originalOptions.get(column.id)
    )
      edit.property_configs.push({ id: column.id, config: column.config });
  // New columns carry their final choices.
  for (const property of edit.new_properties) property.config = columns.find((c) => c.id === property.id)!.config;

  if (!changes.length)
    throw new ToolError("Nothing to change: send a title, description, add_properties, add_rows or update_rows.");
  return {
    edit,
    pageId: page.id,
    result: {
      data: {
        database_id: database.id,
        page_id: page.id,
        changed: changes,
        new_rows: edit.new_records.map((r) => ({ id: r.id, page_id: r.page_id })),
      },
      text: `Updated the database “${title ?? database.name}”: ${changes.join(", ")}.`,
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
    case "update_playbook":
      return updatePlaybook(state, args, newId);
    case "trash_page":
      return trashPage(state, args);
    default:
      throw new ToolError(`There's no tool called “${name}”.`);
  }
}
