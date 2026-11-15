import type { Page, WorkspaceState } from "./types";
export function descendants(pages: Page[], pageId: string): string[] {
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const p of pages.filter((p) => p.parent_id === id)) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        visit(p.id);
      }
    }
  };
  visit(pageId);
  return [...seen];
}
export function canMovePage(pages: Page[], pageId: string, parentId: string | null) {
  return parentId !== pageId && (!parentId || !descendants(pages, pageId).includes(parentId));
}
export function breadcrumbs(pages: Page[], pageId: string): Page[] {
  const result: Page[] = [];
  const visited = new Set<string>();
  let current = pages.find((p) => p.id === pageId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift(current);
    current = pages.find((p) => p.id === current?.parent_id);
  }
  return result;
}
/**
 * Permanently removes a page tree and everything it owns: documents, databases with
 * their schema, views and records (whose pages go too), plus links into removed records.
 * Mirrors the cascades the server applies when these rows disappear from a save.
 */
export function purgePage(state: WorkspaceState, pageId: string): WorkspaceState {
  const pageIds = new Set([pageId, ...descendants(state.pages, pageId)]);
  // A record's page is owned by its database even if its tree parent points elsewhere.
  for (let grew = true; grew;) {
    grew = false;
    const owned = new Set(state.databases.filter((d) => pageIds.has(d.page_id)).map((d) => d.id));
    for (const record of state.records)
      if (owned.has(record.database_id) && !pageIds.has(record.page_id)) {
        for (const id of [record.page_id, ...descendants(state.pages, record.page_id)]) pageIds.add(id);
        grew = true;
      }
  }
  const databaseIds = new Set(state.databases.filter((d) => pageIds.has(d.page_id)).map((d) => d.id));
  const recordIds = new Set(
    state.records.filter((r) => databaseIds.has(r.database_id) || pageIds.has(r.page_id)).map((r) => r.id),
  );
  const removedProperties = new Set(state.properties.filter((p) => databaseIds.has(p.database_id)).map((p) => p.id));
  return {
    ...state,
    pages: state.pages.filter((p) => !pageIds.has(p.id)),
    documents: state.documents.filter((d) => !pageIds.has(d.page_id)),
    databases: state.databases.filter((d) => !databaseIds.has(d.id)),
    properties: state.properties
      .filter((p) => !removedProperties.has(p.id))
      .map((p) => {
        const config = { ...p.config };
        let changed = false;
        if (config.related_database_id && databaseIds.has(config.related_database_id)) {
          delete config.related_database_id;
          changed = true;
        }
        for (const key of ["relation_property_id", "rollup_property_id", "reciprocal_property_id"])
          if (typeof config[key] === "string" && removedProperties.has(config[key] as string)) {
            delete config[key];
            changed = true;
          }
        return changed ? { ...p, config } : p;
      }),
    views: state.views.filter((v) => !databaseIds.has(v.database_id)),
    records: state.records
      .filter((r) => !recordIds.has(r.id))
      .map((r) => {
        let values = r.values;
        for (const [key, value] of Object.entries(r.values))
          if (Array.isArray(value) && value.some((id) => recordIds.has(id)))
            values = { ...values, [key]: value.filter((id) => !recordIds.has(id)) };
        return values === r.values ? r : { ...r, values };
      }),
  };
}
export function trashPage(state: WorkspaceState, pageId: string, restore = false): WorkspaceState {
  const ids = new Set([pageId, ...descendants(state.pages, pageId)]);
  return {
    ...state,
    pages: state.pages.map((p) =>
      ids.has(p.id) ? { ...p, deleted_at: restore ? null : new Date().toISOString() } : p,
    ),
  };
}

/** Where a dragged page lands relative to the row under the pointer. */
export type DropZone = "before" | "after" | "inside";
export interface Placement {
  parentId: string | null;
  index: number;
}

const childrenOf = (pages: Page[], parentId: string | null, without?: string) =>
  pages
    .filter((p) => p.parent_id === parentId && !p.deleted_at && p.id !== without)
    .sort((a, b) => a.position - b.position);

/**
 * Turns "drop above / below / inside this row" into a parent and index, or null when
 * the drop isn't allowed (into itself or its own subpages, or inside a database).
 * Dropping below an expanded page with subpages puts it first inside, which is where
 * the line appears.
 */
export function dropPlacement(
  pages: Page[],
  pageId: string,
  targetId: string,
  zone: DropZone,
  expanded: ReadonlySet<string> = new Set(),
): Placement | null {
  const target = pages.find((p) => p.id === targetId);
  if (!target || targetId === pageId) return null;
  const canHold = (parentId: string | null) =>
    canMovePage(pages, pageId, parentId) &&
    (parentId === null || pages.find((p) => p.id === parentId)?.kind === "document");
  const into = (parentId: string, index: number) => (canHold(parentId) ? { parentId, index } : null);
  if (zone === "inside") return into(targetId, childrenOf(pages, targetId, pageId).length);
  if (zone === "after" && expanded.has(targetId) && childrenOf(pages, targetId, pageId).length)
    return into(targetId, 0);
  const siblings = childrenOf(pages, target.parent_id, pageId);
  const at = siblings.findIndex((p) => p.id === targetId);
  if (!canHold(target.parent_id)) return null;
  return { parentId: target.parent_id, index: zone === "before" ? at : at + 1 };
}

/** Puts a page at `index` among `parentId`'s subpages, renumbering that level. */
export function movePageTo(
  state: WorkspaceState,
  pageId: string,
  parentId: string | null,
  index: number,
): WorkspaceState {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page || !canMovePage(state.pages, pageId, parentId)) return state;
  const level = childrenOf(state.pages, parentId, pageId).filter((p) => p.workspace_id === page.workspace_id);
  level.splice(Math.max(0, Math.min(index, level.length)), 0, page);
  const positions = new Map(level.map((p, i) => [p.id, i]));
  const now = new Date().toISOString();
  return {
    ...state,
    pages: state.pages.map((p) =>
      p.id === pageId
        ? { ...p, parent_id: parentId, position: positions.get(p.id)!, updated_at: now }
        : positions.has(p.id)
          ? { ...p, position: positions.get(p.id)! }
          : p,
    ),
  };
}

/** Where a page sits now, so a move can be undone. */
export function placementOf(pages: Page[], pageId: string): Placement | null {
  const page = pages.find((p) => p.id === pageId);
  if (!page) return null;
  return {
    parentId: page.parent_id,
    index: childrenOf(pages, page.parent_id).findIndex((p) => p.id === pageId),
  };
}
