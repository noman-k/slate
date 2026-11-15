/**
 * Moving a page to another workspace, with everything inside it: subpages, databases and
 * their rows and views, files, and pages of it in the Trash. The server moves it all in one
 * transaction (`move_to_workspace`); here is what the move would do, for the dialog to say
 * before it happens, and the move itself (files are copied to their new place first).
 */
import { getSupabaseClient } from "./supabase/client";
import { descendants } from "./tree";
import type { Database, Property, WorkspaceState } from "./types";

export interface WorkspaceMovePlan {
  /** The page and every page inside it (Trash included). */
  pageIds: string[];
  databases: Database[];
  rows: number;
  /** Relations between a database that moves and one that stays: they'll be unlinked. */
  brokenRelations: { property: Property; database: string; linksTo: string }[];
  /** A database row moves with its database, never on its own. */
  isRow: boolean;
}

export function planWorkspaceMove(state: WorkspaceState, pageId: string): WorkspaceMovePlan {
  const pageIds = [pageId, ...descendants(state.pages, pageId)];
  const inside = new Set(pageIds);
  const databases = state.databases.filter((d) => inside.has(d.page_id));
  const moving = new Set(databases.map((d) => d.id));
  const workspace = state.pages.find((p) => p.id === pageId)?.workspace_id;
  const nameOf = (id: string | undefined) => state.databases.find((d) => d.id === id)?.name || "Untitled";
  const brokenRelations = state.properties
    .filter((p) => {
      if (p.type !== "relation" || !p.config.related_database_id) return false;
      const database = state.databases.find((d) => d.id === p.database_id);
      if (!database || database.workspace_id !== workspace) return false;
      return moving.has(p.database_id) !== moving.has(p.config.related_database_id);
    })
    .map((property) => ({
      property,
      database: nameOf(property.database_id),
      linksTo: nameOf(property.config.related_database_id),
    }));
  return {
    pageIds,
    databases,
    rows: state.records.filter((r) => moving.has(r.database_id) && inside.has(r.page_id)).length,
    brokenRelations,
    isRow: state.records.some((r) => r.page_id === pageId),
  };
}

/** Moves the page (and everything in it) to the workspace, under `parentId` there or at its top. */
export async function moveToWorkspace(
  pageId: string,
  pageIds: string[],
  from: string,
  to: string,
  parentId: string | null,
): Promise<void> {
  const supabase = getSupabaseClient();
  const storage = supabase.storage.from("attachments");
  // Files live under their workspace: copy them to the new place first, so the pages never
  // point at a file that isn't there.
  const { data: files, error: listError } = await supabase
    .from("attachments")
    .select("storage_path")
    .in("page_id", pageIds);
  if (listError) throw new Error("Couldn't look up this page's files. Nothing was moved; try again.");
  const paths = ((files ?? []) as { storage_path: string }[])
    .map((file) => file.storage_path)
    .filter((path) => path.startsWith(`${from}/`));
  const copied: string[] = [];
  for (const path of paths) {
    const target = `${to}${path.slice(from.length)}`;
    const { error } = await storage.copy(path, target);
    if (error && !/exists/i.test(error.message)) {
      if (copied.length) await storage.remove(copied);
      throw new Error("Couldn't copy this page's files to the other workspace. Nothing was moved; try again.");
    }
    copied.push(target);
  }
  const { error } = await supabase.rpc("move_to_workspace", {
    p_page_id: pageId,
    p_workspace_id: to,
    p_parent_id: parentId,
  });
  if (error) {
    if (copied.length) await storage.remove(copied);
    if (/row moves with its database/i.test(error.message))
      throw new Error("A database row moves with its database. Move the database instead.");
    throw new Error("Couldn't move it just now. Nothing was moved; try again.");
  }
  // The old copies aren't needed any more (if this fails, they're only left over).
  if (paths.length) await storage.remove(paths).catch(() => undefined);
}
