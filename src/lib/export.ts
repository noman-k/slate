/**
 * Export Markdown: any page as plain Markdown that reads well anywhere (GitHub, Obsidian, a
 * text editor), showing what the page shows rather than how Slate stores it.
 *
 * - A page: its text, with embedded databases as tables, subpages as links, callouts as
 *   quotes and playbook steps as a checklist.
 * - A database (table page): its rows as a table, as its first view shows them (columns,
 *   filters, sort, pins).
 * - A database row: its properties as a list, then its text.
 */
import { cellValue, formatCell, orderProperties, orderedViews, recordTitle, visibleRecords } from "./database";
import { splitMarkdown } from "./markdown";
import { labelOf, type Param } from "./runner";
import type { DatabaseView, DbRecord, Property, WorkspaceState } from "./types";

/** A cell as Markdown table text: relations as titles, checkboxes as Yes/No. */
function cellText(record: DbRecord, property: Property, state: WorkspaceState) {
  const value = cellValue(record, property, state);
  if (property.type === "checkbox") return value ? "Yes" : "No";
  if (property.type === "relation" && Array.isArray(value))
    return value
      .map((id) => state.records.find((r) => r.id === id))
      .filter((r): r is DbRecord => !!r)
      .map((r) => recordTitle(r, state))
      .join(", ");
  return formatCell(value, property);
}

/** Text that can sit in a table cell: pipes escaped, lines joined with <br>. */
const inCell = (text: string) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();

const liveRecord = (state: WorkspaceState, record: DbRecord) =>
  !state.pages.find((p) => p.id === record.page_id)?.deleted_at;

/** The view a database shows first (or, for a linked block, the block's own first view). */
function firstView(state: WorkspaceState, databaseId: string, viewId?: string, block?: string): DatabaseView {
  const views = state.views.filter((v) => v.database_id === databaseId);
  const chosen =
    views.find((v) => v.id === viewId) ??
    orderedViews(views.filter((v) => (block ? v.placement === block : !v.placement)))[0] ??
    orderedViews(views)[0];
  return (
    chosen ?? {
      id: "",
      database_id: databaseId,
      name: "All",
      type: "table",
      filters: [],
      sorts: [],
      hidden_properties: [],
    }
  );
}

/** A database's rows as a Markdown table, as `view` shows them. */
export function databaseTable(state: WorkspaceState, databaseId: string, view: DatabaseView): string {
  const properties = orderProperties(
    state.properties.filter((p) => p.database_id === databaseId && !p.config.system),
    view.property_order,
  ).filter((p) => !view.hidden_properties.includes(p.id));
  if (!properties.length) return "_No columns._";
  const rows = visibleRecords(databaseId, view, state).filter((record) => liveRecord(state, record));
  const header = `| ${properties.map((p) => inCell(p.name) || " ").join(" | ")} |`;
  const rule = `| ${properties.map((p) => (["number", "currency"].includes(p.type) ? "---:" : "---")).join(" | ")} |`;
  const body = rows.map((record) => `| ${properties.map((p) => inCell(cellText(record, p, state))).join(" | ")} |`);
  return [header, rule, ...body].join("\n") + (rows.length ? "" : "\n\n_No rows._");
}

type JsonNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: JsonNode[] };

/** A stored block's words, with value chips as {{key}}. */
const textOf = (node: JsonNode): string =>
  node.type === "valueRef"
    ? `{{${String(node.attrs?.key ?? "")}}}`
    : (node.text ?? (node.content ?? []).map(textOf).join(""));

/** The paragraphs inside a stored block, one per line. */
const linesOf = (node: JsonNode) =>
  (node.content ?? [])
    .map(textOf)
    .map((line) => line.trim())
    .filter(Boolean);

/** A block saved as data (callout, old-style toggle, playbook inputs or step) as Markdown. */
function richBlock(node: JsonNode): string {
  if (node.type === "callout")
    return (
      linesOf(node)
        .map((line) => `> ${line}`)
        .join("\n>\n") || ">"
    );
  if (node.type === "toggle")
    return `<details>\n<summary>${String(node.attrs?.title ?? "")}</summary>\n\n${linesOf(node).join("\n\n")}\n\n</details>`;
  if (node.type === "procedureParams") {
    const params = ((node.attrs?.params as Param[]) ?? []).filter((p) => p.name);
    return params.length
      ? `**Inputs:** ${params.map((p) => `${labelOf(p)}${p.required ? " (required)" : ""}`).join(", ")}`
      : "";
  }
  if (node.type === "procedureStep") return `- [ ] ${textOf(node).trim()}`;
  return linesOf(node).join("\n\n");
}

/** A page's own text as plain Markdown. */
export function documentMarkdown(state: WorkspaceState, markdown: string, origin: string): string {
  const out: string[] = [];
  for (const part of splitMarkdown(markdown)) {
    if (part.kind === "embed") {
      const { kind, id, viewId, block } = part.directive;
      if (kind === "page") {
        const page = state.pages.find((p) => p.id === id && !p.deleted_at);
        if (page) out.push(`[${page.title || "Untitled"}](${origin}/p/${page.id})`);
      } else {
        const database = state.databases.find((d) => d.id === id);
        const page = state.pages.find((p) => p.id === database?.page_id && !p.deleted_at);
        if (database && page)
          out.push(
            `**${page.title || database.name || "Untitled"}**\n\n${databaseTable(state, id, firstView(state, id, viewId, block))}`,
          );
      }
    } else if (part.kind === "rich") out.push(richBlock(part.node as JsonNode));
    else out.push(part.source);
  }
  // Playbook steps one under another make one checklist, not a list per step.
  return out
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.trim())
    .join("\n\n")
    .replace(/(^- \[ \] .*)\n\n(?=- \[ \] )/gm, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Any page as one Markdown file: title, description, then what the page holds. */
export function pageMarkdown(state: WorkspaceState, pageId: string, origin: string): string {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return "";
  const parts = [`# ${page.title || "Untitled"}`];
  if (page.description?.trim()) parts.push(page.description.trim());
  const record = state.records.find((r) => r.page_id === pageId);
  if (record) {
    const properties = state.properties
      .filter((p) => p.database_id === record.database_id && !p.config.system && p.type !== "title")
      .sort((a, b) => a.position - b.position);
    const items = properties
      .map((p) => [p.name, cellText(record, p, state)] as const)
      .filter(([, text]) => text !== "")
      .map(([name, text]) => `- **${name}:** ${text.replace(/\r?\n/g, " ")}`);
    if (items.length) parts.push(items.join("\n"));
  }
  const database = page.kind === "database" ? state.databases.find((d) => d.page_id === page.id) : undefined;
  if (database) parts.push(databaseTable(state, database.id, firstView(state, database.id)));
  const body = documentMarkdown(state, state.documents.find((d) => d.page_id === pageId)?.markdown ?? "", origin);
  if (body) parts.push(body);
  return `${parts.join("\n\n")}\n`;
}

/** A file name for a page: its title without characters file systems refuse. */
export function exportFileName(title: string) {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${name || "Untitled"}.md`;
}
