export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "currency"
  | "checkbox"
  | "date"
  | "datetime"
  | "select"
  | "multi_select"
  | "status"
  | "url"
  | "email"
  | "phone"
  | "relation"
  | "rollup"
  | "formula"
  | "created_time"
  | "updated_time";
export type CellValue = string | number | boolean | string[] | null;
export interface Workspace {
  id: string;
  name: string;
  owner_id?: string;
}
export interface Page {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  icon: string;
  kind: "document" | "database";
  database_id?: string;
  description: string;
  position: number;
  favorite: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Document {
  page_id: string;
  markdown: string;
  content?: unknown;
  updated_at: string;
}
export type RecordOpenMode = "peek" | "page";
export interface Database {
  id: string;
  workspace_id: string;
  page_id: string;
  name: string;
  /** How its records open: side panel (default) or full page. */ open_mode?: RecordOpenMode;
}
export interface Property {
  id: string;
  database_id: string;
  name: string;
  type: PropertyType;
  position: number;
  width: number;
  config: {
    options?: string[];
    related_database_id?: string;
    relation_property_id?: string;
    rollup_property_id?: string;
    aggregation?: "count" | "sum" | "average" | "min" | "max" | "values";
    expression?: string;
    [key: string]: unknown;
  };
}
export interface DbRecord {
  id: string;
  database_id: string;
  page_id: string;
  values: Record<string, CellValue>;
  position: number;
  created_at: string;
  updated_at: string;
}
export interface ViewFilter {
  property_id: string;
  operator:
    | "contains"
    | "not_contains"
    | "equals"
    | "not_equals"
    | "starts_with"
    | "ends_with"
    | "is_empty"
    | "is_not_empty"
    | "greater_than"
    | "less_than"
    | "greater_or_equal"
    | "less_or_equal"
    | "before"
    | "after"
    | "on_or_before"
    | "on_or_after";
  value: string;
}
/** Rules joined by And or Or (see lib/view-filters.ts). */
export interface ViewFilterGroup {
  type: "group";
  conjunction: "and" | "or";
  rules: (ViewFilter | ViewFilterGroup)[];
  /** The stored root of a filter that isn't just "all of these rules". */
  root?: boolean;
}
export interface DatabaseView {
  id: string;
  database_id: string;
  /** Set for a linked database block's own views (its block id); unset for the database's views. */ placement?:
    string | null;
  name: string;
  type: "table" | "list" | "board";
  filters: (ViewFilter | ViewFilterGroup)[];
  sorts: { property_id: string; direction: "asc" | "desc" }[];
  hidden_properties: string[];
  property_order?: string[];
  group_by?: string;
  /** Its place among the database's tabs; views without one come after, as they were. */
  position?: number | null;
  /** Rows pinned to the top of this view, in the order they show. */
  pinned?: string[];
}
export interface WorkspaceState {
  workspaces: Workspace[];
  pages: Page[];
  documents: Document[];
  databases: Database[];
  properties: Property[];
  records: DbRecord[];
  views: DatabaseView[];
  active_workspace_id: string;
}
export type SaveStatus = "saved" | "saving" | "offline" | "error";
