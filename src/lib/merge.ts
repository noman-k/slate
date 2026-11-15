/**
 * Merging a tab's unsaved changes with changes saved elsewhere (another tab, or an AI agent
 * that created or edited something) instead of refusing the save.
 *
 * It works item by item (each page, document, database, property, view and record): what
 * this tab changed since it last loaded keeps this tab's version; everything else takes the
 * saved version. So an agent editing one page and you editing another both stick. When both
 * changed the same item, the person at the keyboard wins, and the merge says which items.
 */
import type { WorkspaceState } from "./types";

type Collection = "workspaces" | "pages" | "documents" | "databases" | "properties" | "records" | "views";
const KEYS: Record<Collection, string> = {
  workspaces: "id",
  pages: "id",
  documents: "page_id",
  databases: "id",
  properties: "id",
  records: "id",
  views: "id",
};

const same = (a: unknown, b: unknown) =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

export interface Merged {
  state: WorkspaceState;
  /** Pages (by id) that both sides changed; this tab's version was kept. */
  overlaps: string[];
}

export function mergeStates(base: WorkspaceState, local: WorkspaceState, remote: WorkspaceState): Merged {
  const overlaps = new Set<string>();
  const merged = { ...remote, active_workspace_id: local.active_workspace_id } as WorkspaceState;
  for (const collection of Object.keys(KEYS) as Collection[]) {
    const key = KEYS[collection];
    type Item = Record<string, unknown>;
    const index = (items: Item[]) => new Map(items.map((item) => [String(item[key]), item]));
    const before = index(base[collection] as unknown as Item[]);
    const mine = index(local[collection] as unknown as Item[]);
    const theirs = index(remote[collection] as unknown as Item[]);
    const out: Item[] = [];
    const seen = new Set<string>();
    const decide = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const b = before.get(id);
      const l = mine.get(id);
      const r = theirs.get(id);
      const changedHere = !same(b, l);
      if (changedHere) {
        if (!same(b, r) && !same(l, r)) {
          // Both sides changed it: note the page it belongs to.
          const page =
            collection === "pages"
              ? id
              : collection === "documents"
                ? id
                : collection === "records"
                  ? String((l ?? r)?.page_id ?? "")
                  : "";
          if (page) overlaps.add(page);
        }
        if (l) out.push(l);
      } else if (r) out.push(r);
    };
    // The saved order first, then anything only this tab has.
    for (const id of theirs.keys()) decide(id);
    for (const id of mine.keys()) decide(id);
    (merged as unknown as Record<Collection, Item[]>)[collection] = out;
  }
  // The open workspace must still exist.
  if (!merged.workspaces.some((w) => w.id === merged.active_workspace_id))
    merged.active_workspace_id = merged.workspaces[0]?.id ?? "";
  return { state: merged, overlaps: [...overlaps] };
}
