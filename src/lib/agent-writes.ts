/**
 * Tools that let an AI agent create things in a workspace: a page, a database (with its
 * properties and rows) or a playbook. They need a key with the "write" scope.
 *
 * They only add. Nothing an agent sends can change or remove what's already there: each
 * tool plans the new rows here (pure, so tests and the MCP server share it), and the
 * database applies them in one transaction through `agent_create`, which checks the key
 * and that every row lands in the owner's own workspace.
 */
import { ToolError, type ToolDefinition, type ToolResult } from "./agent-tools";
import { checkPlaybook } from "./playbook-checks";
import { serializePlaybook, type BuilderSection, type BuilderStep, type PlaybookModel } from "./playbook-model";
import { END, NEXT, keyFor, type AnswerType, type ConditionOp, type HttpMethod, type Param, type ParamType, type StepAttrs } from "./runner";
import { encodeDirective } from "./markdown";
import type { CellValue, DbRecord, Database, DatabaseView, Document, Page, Property, PropertyType, WorkspaceState } from "./types";

/** What `agent_create` inserts. `appends` adds text to the end of an existing page. */
export interface Creation {
  pages: Omit<Page, "favorite" | "deleted_at" | "created_at" | "updated_at">[];
  documents: Pick<Document, "page_id" | "markdown">[];
  databases: Pick<Database, "id" | "workspace_id" | "page_id" | "name">[];
  properties: Property[];
  views: Pick<DatabaseView, "id" | "database_id" | "name" | "type" | "group_by">[];
  records: Pick<DbRecord, "id" | "database_id" | "page_id" | "position" | "values">[];
  appends: { page_id: string; text: string }[];
}
export interface Planned {
  creation: Creation;
  /** Answer for the agent, before the page's address is added. */
  result: ToolResult;
  /** The page people open to see what was made. */
  pageId: string;
}

export const CREATES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
export const TITLE_MAX = 200;
export const TEXT_MAX = 100_000;
export const MAX_PROPERTIES = 30;
export const MAX_RECORDS = 200;
const MAX_SECTIONS = 30;
const MAX_STEPS = 100;

export const AGENT_PROPERTY_TYPES = ["text", "number", "currency", "checkbox", "date", "select", "multi_select", "status", "url", "email", "phone"] as const;
export type AgentPropertyType = (typeof AGENT_PROPERTY_TYPES)[number];
const STEP_KINDS = ["check", "ask", "say", "decide", "call", "finish"] as const;
const STEP_TYPE: Record<(typeof STEP_KINDS)[number], StepAttrs["step"]> = {
  check: "check",
  ask: "ask",
  say: "send",
  decide: "if",
  call: "api",
  finish: "end",
};
const INPUT_TYPES: ParamType[] = ["text", "number", "date", "yesno", "choice"];
const ANSWERS: AnswerType[] = ["text", "number", "yesno", "choice"];
const OPS: ConditionOp[] = ["is", "is_not", "contains", "gt", "lt", "set", "not_set"];
const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const parentProp = {
  type: "string",
  description: "Put it inside this page (an id from search_workspace or read_page). Leave out to add it at the top level.",
};

export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: "create_page",
    title: "Create a page",
    description:
      "Create a new page with a title and Markdown text (headings, lists, to-dos like '- [ ] task', tables, code). " +
      "It's added at the top level, or inside an existing page, where it shows as a link in that page's text. " +
      "Returns the new page's id and address. Creates only; it never changes existing pages.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The page's title.", maxLength: TITLE_MAX },
        content: { type: "string", description: "The page's text, in Markdown.", maxLength: TEXT_MAX },
        parent_page_id: parentProp,
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: CREATES,
  },
  {
    name: "create_database",
    title: "Create a database",
    description:
      "Create a new database: a table of records with typed properties (columns), optionally filled with rows, shown as a table, board or list. " +
      "Every database has a title property (its first column). Select, multi_select and status choices not listed in `options` are added from the rows. " +
      "Returns the new database's page id and address. Creates only; it can't add rows to existing databases.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The database's name.", maxLength: TITLE_MAX },
        description: { type: "string", description: "A line about what it holds (optional).", maxLength: 2000 },
        parent_page_id: parentProp,
        title_property: { type: "string", description: "Name of the title column (default “Name”)." },
        properties: {
          type: "array",
          maxItems: MAX_PROPERTIES,
          description: "The other columns, in order. Leave out for a simple Status column.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: [...AGENT_PROPERTY_TYPES] },
              options: { type: "array", items: { type: "string" }, description: "Choices for select, multi_select and status." },
            },
            required: ["name", "type"],
            additionalProperties: false,
          },
        },
        rows: {
          type: "array",
          maxItems: MAX_RECORDS,
          description:
            "Rows to start with: objects keyed by property name, e.g. {\"Name\": \"Unit 1A\", \"Rent\": 1300, \"Paid\": true, \"Due\": \"2026-12-01\"}. " +
            "Numbers as numbers, checkboxes as true/false, dates as YYYY-MM-DD, multi_select as a list.",
          items: { type: "object" },
        },
        view: { type: "string", enum: ["table", "board", "list"], description: "How it opens (default table). A board groups by the first status or select column." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: CREATES,
  },
  {
    name: "create_playbook",
    title: "Create a playbook",
    description:
      "Create a playbook: a step-by-step procedure people run in Slate, with inputs asked for at the start and sections of steps. " +
      "Step types: check (do something and confirm it), ask (a question; save_as names the answer), say (something to tell someone), " +
      "decide (branch on an input or answer), call (an HTTP request; save_as names the response) and finish (ends the run with an outcome). " +
      "Use {{name}} in text to insert an input or answer (inputs are named from their label: “Order number” → order_number). " +
      "go_to targets are a section title, \"next\" or \"finish\". The playbook is checked before it's created: problems come back as an error to fix.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: TITLE_MAX },
        when_to_use: { type: "string", description: "When someone should run it, e.g. “A customer asks for a refund.”", maxLength: 500 },
        parent_page_id: parentProp,
        inputs: {
          type: "array",
          description: "What to ask for when a run starts.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "What people see, e.g. “Order number”." },
              type: { type: "string", enum: INPUT_TYPES },
              required: { type: "boolean" },
              options: { type: "array", items: { type: "string" }, description: "Choices for type “choice”." },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
        guidelines: { type: "array", items: { type: "string" }, description: "Short rules to keep in mind during every run." },
        sections: {
          type: "array",
          minItems: 1,
          maxItems: MAX_SECTIONS,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              steps: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: [...STEP_KINDS] },
                    text: { type: "string", description: "What to do, ask or say; for finish, the outcome; for decide, an optional note." },
                    expect: { type: "string", description: "check: what you should see when it worked." },
                    answer: { type: "string", enum: ANSWERS, description: "ask: the kind of answer (default text)." },
                    choices: { type: "array", items: { type: "string" }, description: "ask with answer “choice”." },
                    save_as: { type: "string", description: "ask, call: the name later steps use, e.g. accepts_credit." },
                    value: { type: "string", description: "decide: the input or answer to check (its name)." },
                    is: { type: "string", enum: OPS, description: "decide: the comparison (default is)." },
                    compare_to: { type: "string", description: "decide: what to compare with." },
                    then_go_to: { type: "string", description: "decide: where to go when it holds (default next)." },
                    otherwise_go_to: { type: "string", description: "decide: where to go otherwise. check, call: where to go if it fails." },
                    method: { type: "string", enum: METHODS },
                    url: { type: "string" },
                    headers: { type: "string", description: "call: one “Name: value” per line." },
                    body: { type: "string" },
                  },
                  required: ["type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["title", "steps"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "sections"],
      additionalProperties: false,
    },
    annotations: CREATES,
  },
];

export const isWriteTool = (name: string) => WRITE_TOOLS.some((tool) => tool.name === name);

/* ---------- Shared checks ---------- */

export const text = (value: unknown, what: string, max: number, required = false) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ToolError(`Add ${what}.`);
    return "";
  }
  if (typeof value !== "string") throw new ToolError(`${capital(what)} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ToolError(`Add ${what}.`);
  if (trimmed.length > max) throw new ToolError(`${capital(what)} is too long (at most ${max.toLocaleString("en")} characters).`);
  return trimmed;
};
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const list = (value: unknown, what: string): unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ToolError(`${capital(what)} must be a list.`);
  return value;
};
export const record = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolError(`Each of ${what} must be an object.`);
  return value as Record<string, unknown>;
};

/**
 * Agent Markdown is text, never app structure: `:::slate` lines (embeds and playbook steps)
 * are dropped, so it can't pull in other databases or pages by id.
 */
export function plainMarkdown(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => !/^\s*:::slate(-node)?\s/.test(line))
    .join("\n")
    .trim();
}

interface Context {
  state: WorkspaceState;
  newId: () => string;
}

/** Where a new page goes: its parent (if any), workspace and position among its siblings. */
function placement({ state }: Context, parentId: unknown) {
  const live = state.pages.filter((p) => !p.deleted_at);
  if (parentId === undefined || parentId === null || parentId === "") {
    const workspace = state.active_workspace_id || state.workspaces[0]?.id;
    if (!workspace) throw new ToolError("This account has no workspace to add to.");
    return { parent: null, workspace, position: live.filter((p) => p.workspace_id === workspace && !p.parent_id).length };
  }
  if (typeof parentId !== "string") throw new ToolError("parent_page_id must be a page id.");
  const parent = live.find((p) => p.id === parentId);
  if (!parent) throw new ToolError(`There's no page with the id “${parentId}”. Use search_workspace to find one.`);
  if (parent.kind === "database")
    throw new ToolError(`“${parent.title}” is a database; pages can't be added inside it. Choose a page instead.`);
  if (state.records.some((r) => r.page_id === parent.id))
    throw new ToolError(`“${parent.title}” is a database row; choose a page instead.`);
  return { parent, workspace: parent.workspace_id, position: live.filter((p) => p.parent_id === parent.id).length };
}

const emptyCreation = (): Creation => ({ pages: [], documents: [], databases: [], properties: [], views: [], records: [], appends: [] });

/** The page itself, its text, and (inside a parent) a link block at the end of the parent's text. */
function addPage(
  creation: Creation,
  where: ReturnType<typeof placement>,
  page: { id: string; title: string; kind: Page["kind"]; database_id?: string; description?: string; icon?: string; markdown: string },
) {
  creation.pages.push({
    id: page.id,
    workspace_id: where.workspace,
    parent_id: where.parent?.id ?? null,
    title: page.title,
    icon: page.icon ?? "",
    kind: page.kind,
    database_id: page.database_id,
    description: page.description ?? "",
    position: where.position,
  });
  creation.documents.push({ page_id: page.id, markdown: page.markdown });
  if (where.parent) creation.appends.push({ page_id: where.parent.id, text: encodeDirective({ kind: "page", id: page.id }) });
}

const placeText = (where: ReturnType<typeof placement>) => (where.parent ? `inside “${where.parent.title}”` : "at the top level");

/* ---------- create_page ---------- */

function createPage(context: Context, args: Record<string, unknown>): Planned {
  const title = text(args.title, "a title", TITLE_MAX, true);
  const markdown = plainMarkdown(text(args.content, "the content", TEXT_MAX));
  const where = placement(context, args.parent_page_id);
  const creation = emptyCreation();
  const id = context.newId();
  addPage(creation, where, { id, title, kind: "document", markdown: markdown ? `${markdown}\n` : "" });
  return {
    creation,
    pageId: id,
    result: { data: { page_id: id, title, parent_page_id: where.parent?.id ?? null }, text: `Created the page “${title}” ${placeText(where)}.` },
  };
}

/* ---------- create_database ---------- */

export function cell(type: PropertyType, raw: unknown, column: string, row: number): CellValue {
  const where = `“${column}” in row ${row + 1}`;
  if (raw === null || raw === undefined || raw === "") return null;
  switch (type) {
    case "number":
    case "currency": {
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(value)) throw new ToolError(`${capital(where)} must be a number.`);
      return value;
    }
    case "checkbox":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "false") return raw === "true";
      throw new ToolError(`${capital(where)} must be true or false.`);
    case "date":
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))) return raw;
      throw new ToolError(`${capital(where)} must be a date like 2026-12-01.`);
    case "multi_select": {
      const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
      if (!values || values.some((v) => typeof v !== "string")) throw new ToolError(`${capital(where)} must be a list of choices.`);
      return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
    }
    default:
      if (typeof raw === "string" || typeof raw === "number") return String(raw).slice(0, 2000);
      throw new ToolError(`${capital(where)} must be text.`);
  }
}

function createDatabase(context: Context, args: Record<string, unknown>): Planned {
  const title = text(args.title, "a name for the database", TITLE_MAX, true);
  const description = text(args.description, "the description", 2000);
  const titleName = text(args.title_property, "the title property", 100) || "Name";
  const view = args.view === undefined ? "table" : args.view;
  if (view !== "table" && view !== "board" && view !== "list") throw new ToolError("view must be table, board or list.");
  const where = placement(context, args.parent_page_id);
  const { newId } = context;
  const pageId = newId();
  const databaseId = newId();

  const columns = list(args.properties, "properties").map((raw, index) => {
    const column = record(raw, "the properties");
    const name = text(column.name, `a name for property ${index + 1}`, 100, true);
    const type = column.type as AgentPropertyType;
    if (!AGENT_PROPERTY_TYPES.includes(type))
      throw new ToolError(`“${name}” needs a type: one of ${AGENT_PROPERTY_TYPES.join(", ")}.`);
    const options = list(column.options, `the options for “${name}”`).map((o) => String(o).trim()).filter(Boolean);
    return { name, type, options };
  });
  if (!args.properties) columns.push({ name: "Status", type: "status", options: ["Not started", "In progress", "Done"] });
  if (columns.length > MAX_PROPERTIES) throw new ToolError(`A database can have at most ${MAX_PROPERTIES} properties here.`);
  const names = [titleName, ...columns.map((c) => c.name)].map((n) => n.toLowerCase());
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) throw new ToolError(`Two properties are called “${duplicate}”; give each its own name.`);

  const properties: Property[] = [
    { id: newId(), database_id: databaseId, name: titleName, type: "title", position: 0, width: 320, config: {} },
    ...columns.map((c, i) => ({
      id: newId(),
      database_id: databaseId,
      name: c.name,
      type: c.type as PropertyType,
      position: i + 1,
      width: c.type === "status" || c.type === "checkbox" ? 160 : 200,
      config: ["select", "multi_select", "status"].includes(c.type) ? { options: [...new Set(c.options)] } : {},
    })),
  ];
  const byName = new Map(properties.map((p) => [p.name.toLowerCase(), p]));

  const creation = emptyCreation();
  addPage(creation, where, { id: pageId, title, kind: "database", database_id: databaseId, description, markdown: "" });
  creation.databases.push({ id: databaseId, workspace_id: where.workspace, page_id: pageId, name: title });

  const rows = list(args.rows, "rows");
  if (rows.length > MAX_RECORDS) throw new ToolError(`At most ${MAX_RECORDS} rows can be added at once.`);
  rows.forEach((raw, index) => {
    const row = record(raw, "the rows");
    const values: Record<string, CellValue> = {};
    for (const [key, value] of Object.entries(row)) {
      const property = byName.get(key.trim().toLowerCase());
      if (!property)
        throw new ToolError(`Row ${index + 1} has “${key}”, which isn't a property. The properties are: ${properties.map((p) => p.name).join(", ")}.`);
      const parsed = cell(property.type, value, property.name, index);
      if (parsed === null) continue;
      values[property.id] = parsed;
      // A choice that isn't listed yet becomes one.
      if (["select", "multi_select", "status"].includes(property.type)) {
        const options = (property.config.options ||= []);
        for (const choice of Array.isArray(parsed) ? parsed : [String(parsed)]) if (!options.includes(choice)) options.push(choice);
      }
    }
    const rowTitle = typeof values[properties[0].id] === "string" ? String(values[properties[0].id]) : "";
    const recordPage = newId();
    creation.pages.push({
      id: recordPage,
      workspace_id: where.workspace,
      parent_id: pageId,
      title: rowTitle || "Untitled",
      icon: "",
      kind: "document",
      description: "",
      position: index,
    });
    creation.documents.push({ page_id: recordPage, markdown: "" });
    creation.records.push({ id: newId(), database_id: databaseId, page_id: recordPage, position: index, values });
  });

  const groupBy = view === "board" ? properties.find((p) => p.type === "status" || p.type === "select")?.id : undefined;
  creation.properties.push(...properties);
  creation.views.push({ id: newId(), database_id: databaseId, name: capital(view), type: view, group_by: groupBy });
  return {
    creation,
    pageId,
    result: {
      data: {
        page_id: pageId,
        database_id: databaseId,
        title,
        properties: properties.map((p) => ({ name: p.name, type: p.type, ...(p.config.options ? { options: p.config.options } : {}) })),
        rows: rows.length,
      },
      text: `Created the database “${title}” ${placeText(where)}, with ${properties.length} properties and ${rows.length} row${rows.length === 1 ? "" : "s"}.`,
    },
  };
}

/* ---------- create_playbook ---------- */

function target(raw: unknown, sections: string[], what: string) {
  if (raw === undefined || raw === null || raw === "") return NEXT;
  if (typeof raw !== "string") throw new ToolError(`${capital(what)} must be a section title, "next" or "finish".`);
  const value = raw.trim();
  if (/^next$/i.test(value)) return NEXT;
  if (/^(finish|end)$/i.test(value)) return END;
  const match = sections.find((title) => title.toLowerCase() === value.toLowerCase());
  if (!match) throw new ToolError(`${capital(what)} goes to “${value}”, but the sections are: ${sections.join(", ")}.`);
  return match;
}

/** A checked playbook from an agent's definition (shared by create_playbook and update_playbook). */
export interface BuiltPlaybook {
  model: PlaybookModel;
  sections: BuilderSection[];
  params: Param[];
  tips: string[];
  stepCount: number;
}

export function buildPlaybook(args: Record<string, unknown>, newId: () => string, verb: "created" | "changed"): BuiltPlaybook {

  const params: Param[] = list(args.inputs, "inputs").map((raw, index) => {
    const input = record(raw, "the inputs");
    const label = text(input.label, `a label for input ${index + 1}`, 100, true);
    const type = (input.type ?? "text") as ParamType;
    if (!INPUT_TYPES.includes(type)) throw new ToolError(`Input “${label}” needs a type: one of ${INPUT_TYPES.join(", ")}.`);
    const options = list(input.options, `the options for “${label}”`).map((o) => String(o).trim()).filter(Boolean);
    if (type === "choice" && !options.length) throw new ToolError(`Input “${label}” is a choice: add its options.`);
    return { name: keyFor(label), label, type, required: input.required !== false, ...(type === "choice" ? { options } : {}) };
  });
  const guidelines = list(args.guidelines, "guidelines").map((g) => String(g).trim()).filter(Boolean);

  const rawSections = list(args.sections, "sections");
  if (!rawSections.length) throw new ToolError("Add at least one section with steps.");
  if (rawSections.length > MAX_SECTIONS) throw new ToolError(`At most ${MAX_SECTIONS} sections.`);
  const sectionTitles = rawSections.map((raw, i) => text(record(raw, "the sections").title, `a title for section ${i + 1}`, 200, true));
  const repeated = sectionTitles.find((t, i) => sectionTitles.findIndex((u) => u.toLowerCase() === t.toLowerCase()) !== i);
  if (repeated) throw new ToolError(`Two sections are called “${repeated}”; jumps need each title to be different.`);

  let count = 0;
  const sections: BuilderSection[] = rawSections.map((raw, si) => {
    const section = record(raw, "the sections");
    const steps = list(section.steps, `the steps of “${sectionTitles[si]}”`);
    if (!steps.length) throw new ToolError(`Section “${sectionTitles[si]}” needs at least one step.`);
    return {
      id: newId(),
      title: sectionTitles[si],
      description: text(section.description, "the section description", 500),
      steps: steps.map((rawStep, i): BuilderStep => {
        if (++count > MAX_STEPS) throw new ToolError(`At most ${MAX_STEPS} steps in a playbook.`);
        const step = record(rawStep, "the steps");
        const label = `step ${i + 1} of “${sectionTitles[si]}”`;
        const kind = step.type as (typeof STEP_KINDS)[number];
        if (!STEP_KINDS.includes(kind)) throw new ToolError(`${capital(label)} needs a type: one of ${STEP_KINDS.join(", ")}.`);
        const attrs: Record<string, unknown> = { step: STEP_TYPE[kind] };
        if (kind === "check") {
          attrs.expected = text(step.expect, "expect", 1000);
          attrs.else = target(step.otherwise_go_to, sectionTitles, label);
        }
        if (kind === "ask") {
          const answer = (step.answer ?? "text") as AnswerType;
          if (!ANSWERS.includes(answer)) throw new ToolError(`${capital(label)}: answer must be one of ${ANSWERS.join(", ")}.`);
          attrs.answer = answer;
          attrs.variable = keyFor(text(step.save_as, "save_as", 100) || `answer_${count}`);
          if (answer === "choice") attrs.options = list(step.choices, "choices").map((c) => String(c).trim()).filter(Boolean).join(", ");
        }
        if (kind === "decide") {
          // A label works too: "Days since delivery" → days_since_delivery (fields after a dot stay).
          const [base, ...path] = text(step.value, `the value ${label} checks`, 200, true).split(".");
          attrs.variable = [keyFor(base) || base, ...path].join(".");
          const op = (step.is ?? "is") as ConditionOp;
          if (!OPS.includes(op)) throw new ToolError(`${capital(label)}: “is” must be one of ${OPS.join(", ")}.`);
          attrs.op = op;
          attrs.value = text(step.compare_to, "compare_to", 500);
          attrs.then = target(step.then_go_to, sectionTitles, label);
          attrs.else = target(step.otherwise_go_to, sectionTitles, label);
        }
        if (kind === "call") {
          const method = (step.method ?? "GET") as HttpMethod;
          if (!METHODS.includes(method)) throw new ToolError(`${capital(label)}: method must be one of ${METHODS.join(", ")}.`);
          Object.assign(attrs, {
            method,
            url: text(step.url, `the URL for ${label}`, 2000, true),
            headers: text(step.headers, "headers", 4000),
            body: text(step.body, "body", 20_000),
            variable: keyFor(text(step.save_as, "save_as", 100)),
            else: target(step.otherwise_go_to, sectionTitles, label),
          });
        }
        const words = text(step.text, `the text of ${label}`, 4000, kind === "check" || kind === "ask" || kind === "say");
        return { id: newId(), attrs: attrs as BuilderStep["attrs"], content: words ? [{ type: "text", text: words }] : [] };
      }),
    };
  });

  const model: PlaybookModel = { details: null, params, guidelines, sections, notes: "" };
  // The builder's own checks: anything it calls a problem is sent back to fix first.
  const checks = checkPlaybook(model);
  const where_ = (stepId: string) => {
    for (const section of sections) {
      const index = section.steps.findIndex((s) => s.id === stepId);
      if (index >= 0) return `Step ${index + 1} of “${section.title}”`;
    }
    return "A step";
  };
  const issues = [
    ...[...checks.steps].flatMap(([stepId, list]) => list.map((issue) => ({ ...issue, at: where_(stepId) }))),
    ...[...checks.sections].flatMap(([sectionId, list]) =>
      list.map((issue) => ({ ...issue, at: `Section “${sections.find((s) => s.id === sectionId)?.title ?? ""}”` })),
    ),
  ];
  const problems = issues.filter((i) => i.level === "warning");
  if (problems.length)
    throw new ToolError(
      `The playbook wasn't ${verb}; please fix:\n${problems.map((p) => `- ${p.at}: ${p.message}`).join("\n")}` +
        (params.length ? `\nInputs are named: ${params.map((p) => p.name).join(", ")}.` : ""),
    );
  const tips = issues.filter((i) => i.level === "tip").map((t) => `${t.at}: ${t.message}`);
  return { model, sections, params, tips, stepCount: sections.reduce((n, s) => n + s.steps.length, 0) };
}

/** The "When to use" line, as the builder writes it. */
export const whenToUseLine = (value: string) => (value ? (/^when to use/i.test(value) ? value : `When to use: ${value}`) : "");

function createPlaybook(context: Context, args: Record<string, unknown>): Planned {
  const title = text(args.title, "a title", TITLE_MAX, true);
  const whenToUse = text(args.when_to_use, "when_to_use", 500);
  const where = placement(context, args.parent_page_id);
  const { model, sections, params, tips, stepCount } = buildPlaybook(args, context.newId, "created");
  const { newId } = context;

  const creation = emptyCreation();
  const id = newId();
  addPage(creation, where, {
    id,
    title,
    kind: "document",
    icon: "icon:compass:blue",
    description: whenToUseLine(whenToUse),
    markdown: serializePlaybook(model),
  });
  return {
    creation,
    pageId: id,
    result: {
      data: { page_id: id, title, inputs: params.map((p) => p.name), sections: sections.map((s) => s.title), steps: stepCount, tips },
      text:
        `Created the playbook “${title}” ${placeText(where)}: ${sections.length} section${sections.length === 1 ? "" : "s"}, ${stepCount} step${stepCount === 1 ? "" : "s"}.` +
        (tips.length ? `\nTips:\n${tips.map((t) => `- ${t}`).join("\n")}` : ""),
    },
  };
}

/** Plans one write tool. Throws ToolError for a problem the agent can fix. */
export function planCreation(
  state: WorkspaceState,
  name: string,
  args: Record<string, unknown> = {},
  newId: () => string = () => crypto.randomUUID(),
): Planned {
  const context = { state, newId };
  switch (name) {
    case "create_page":
      return createPage(context, args);
    case "create_database":
      return createDatabase(context, args);
    case "create_playbook":
      return createPlaybook(context, args);
    default:
      throw new ToolError(`There's no tool called “${name}”.`);
  }
}
