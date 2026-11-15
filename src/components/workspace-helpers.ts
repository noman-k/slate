/** Plain helpers for the workspace: new databases' rows, how records open, exports, dates. */
import { id } from "@/lib/utils";
import type { WorkspaceState } from "@/lib/types";
import { isPhoneWidth } from "./keys";

export function download(name: string, content: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export type StarterView = "table" | "board" | "list";
/** The rows a fresh database needs: itself, a title and status property, one view. */
export function databaseScaffold(
  databaseId: string,
  pageId: string,
  workspaceId: string,
  name: string,
  viewType: StarterView = "table",
) {
  return {
    database: {
      id: databaseId,
      workspace_id: workspaceId,
      page_id: pageId,
      name,
    },
    properties: [
      {
        id: id(),
        database_id: databaseId,
        name: "Name",
        type: "title" as const,
        position: 0,
        width: 320,
        config: {},
      },
      {
        id: id(),
        database_id: databaseId,
        name: "Status",
        type: "status" as const,
        position: 1,
        width: 160,
        config: { options: ["Not started", "In progress", "Done"] },
      },
    ],
    view: {
      id: id(),
      database_id: databaseId,
      name: viewType === "table" ? "Table" : viewType === "board" ? "Board" : "List",
      type: viewType,
      filters: [],
      sorts: [],
      hidden_properties: [],
    },
  };
}
/** Whether this page is a record of a database that opens its records as full pages. */
export function opensAsPage(state: WorkspaceState, pageId: string) {
  const record = state.records.find((r) => r.page_id === pageId);
  if (!record) return false;
  // On a phone every record is a full page (a side panel would fill the screen anyway).
  if (isPhoneWidth()) return true;
  return state.databases.find((d) => d.id === record.database_id)?.open_mode === "page";
}
export function withDatabase(
  s: WorkspaceState,
  made: ReturnType<typeof databaseScaffold>,
): Pick<WorkspaceState, "databases" | "properties" | "views"> {
  return {
    databases: [...s.databases, made.database],
    properties: [...s.properties, ...made.properties],
    views: [...s.views, made.view],
  };
}

/** "just now", "3 hours ago", "yesterday", "12 days ago". */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "just now";
}
