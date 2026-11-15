import { encodeDirective, joinMarkdown, splitMarkdown } from "./markdown";
import type { DatabaseView, WorkspaceState } from "./types";
import { id } from "./utils";

/**
 * Subpages live in their parent's document as page blocks (`:::slate {"kind":"page",…}`
 * lines). These helpers keep those blocks in step with the page tree.
 */
const isBlockFor = (pageId: string) => (part: ReturnType<typeof splitMarkdown>[number]) =>
  part.kind === "embed" && part.directive.kind === "page" && part.directive.id === pageId;

/** Databases embedded in a document (each id once), in order. */
export function databaseIdsIn(markdown: string): string[] {
  const ids = splitMarkdown(markdown)
    .filter((part) => part.kind === "embed" && part.directive.kind === "database")
    .map((part) => (part.kind === "embed" ? part.directive.id : ""));
  return [...new Set(ids)];
}

export function hasPageBlock(markdown: string, pageId: string): boolean {
  return splitMarkdown(markdown).some(isBlockFor(pageId));
}

/**
 * Whether a child page already appears in its parent's text: as a page link, or
 * (for a database page) as an inline database embed.
 */
export function isShownInPage(markdown: string, child: { id: string; database_id?: string }): boolean {
  return splitMarkdown(markdown).some(
    (part) =>
      part.kind === "embed" &&
      ((part.directive.kind === "page" && part.directive.id === child.id) ||
        (part.directive.kind === "database" && !!child.database_id && part.directive.id === child.database_id)),
  );
}

/** Adds a block for `pageId` at the end of the document, unless one is already there. */
export function appendPageBlock(markdown: string, pageId: string): string {
  if (hasPageBlock(markdown, pageId)) return markdown;
  const body = markdown.replace(/\s+$/, "");
  const block = encodeDirective({ kind: "page", id: pageId });
  return body ? `${body}\n\n${block}\n` : `${block}\n`;
}

/** Removes every block for `pageId`, and the blank line it leaves behind. */
export function removePageBlocks(markdown: string, pageId: string): string {
  const parts = splitMarkdown(markdown);
  if (!parts.some(isBlockFor(pageId))) return markdown;
  return joinMarkdown(parts.filter((part) => !isBlockFor(pageId)(part)))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n{2,}$/, "\n");
}

function editDocument(state: WorkspaceState, pageId: string, edit: (markdown: string) => string): WorkspaceState {
  const page = state.pages.find((p) => p.id === pageId);
  // Only documents hold page blocks; a database's children are its records.
  if (!page || page.kind !== "document") return state;
  const now = new Date().toISOString();
  const existing = state.documents.find((d) => d.page_id === pageId);
  const before = existing?.markdown ?? "";
  const after = edit(before);
  if (after === before) return state;
  return {
    ...state,
    documents: existing
      ? state.documents.map((d) => (d.page_id === pageId ? { ...d, markdown: after, updated_at: now } : d))
      : [...state.documents, { page_id: pageId, markdown: after, updated_at: now }],
  };
}

/**
 * Copies of a database's own views for a linked block, so filters, sorts and layout
 * there don't change the original or other pages. Rows and properties stay shared.
 */
export function placementViews(state: WorkspaceState, databaseId: string, block: string): DatabaseView[] {
  const own = state.views.filter((v) => v.database_id === databaseId && !v.placement);
  const base: DatabaseView[] = own.length
    ? own
    : [
        {
          id: "",
          database_id: databaseId,
          name: "Table",
          type: "table",
          filters: [],
          sorts: [],
          hidden_properties: [],
        },
      ];
  return base.map((v) => ({ ...structuredClone(v), id: id(), placement: block }));
}

const isOwnedEmbed = (databaseId: string) => (part: ReturnType<typeof splitMarkdown>[number]) =>
  part.kind === "embed" &&
  part.directive.kind === "database" &&
  part.directive.id === databaseId &&
  !part.directive.block;

/**
 * When a database moves out of the page it was created in, the copy left in that
 * page's text becomes a linked view: it gets a block id and its own views, so changing
 * its layout there no longer changes the database's own page (and vice versa).
 */
export function linkLeftBehind(state: WorkspaceState, pageId: string, databaseId: string): WorkspaceState {
  const parts = splitMarkdown(state.documents.find((d) => d.page_id === pageId)?.markdown ?? "");
  if (!parts.some(isOwnedEmbed(databaseId))) return state;
  const views: DatabaseView[] = [];
  const next = editDocument(state, pageId, () =>
    joinMarkdown(
      parts.map((part) => {
        if (!isOwnedEmbed(databaseId)(part) || part.kind !== "embed") return part;
        const block = id();
        views.push(...placementViews(state, databaseId, block));
        const directive = { ...part.directive, block };
        return { ...part, directive, source: encodeDirective(directive) };
      }),
    ),
  );
  return { ...next, views: [...next.views, ...views] };
}

/**
 * Moves `pageId`'s block from its old parent's document to its new parent's,
 * so what a page shows always matches the sidebar tree. A database already shown in
 * either page as an embed stays an embed (linked, in the page it left).
 */
export function relinkPageBlock(
  state: WorkspaceState,
  pageId: string,
  fromParent: string | null,
  toParent: string | null,
): WorkspaceState {
  let next = state;
  const databaseId = state.pages.find((p) => p.id === pageId)?.database_id;
  if (fromParent && fromParent !== toParent) {
    next = editDocument(next, fromParent, (md) => removePageBlocks(md, pageId));
    if (databaseId) next = linkLeftBehind(next, fromParent, databaseId);
  }
  if (toParent)
    next = editDocument(next, toParent, (md) =>
      databaseId && databaseIdsIn(md).includes(databaseId) ? md : appendPageBlock(md, pageId),
    );
  return next;
}
