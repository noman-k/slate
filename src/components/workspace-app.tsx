"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  Cloud,
  CloudOff,
  Copy,
  Download,
  ClipboardList,
  Compass,
  FileText,
  HelpCircle,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Star,
  AlignLeft,
  ChevronRight,
  SmilePlus,
  Table2,
  KanbanSquare,
  List,
} from "lucide-react";
import { toast } from "sonner";
import { Sidebar, PageActions, type PageAction } from "./sidebar";
import { SearchDialog } from "./search-dialog";
import { ShortcutsPopover } from "./shortcuts";
import { PageIcon, parsePageIcon } from "./page-icon";
import { BrandMark } from "./brand";
import { databaseIdsIn, isShownInPage, placementViews, relinkPageBlock } from "@/lib/page-blocks";
import { templateMarkdown, type ProcedureKind, type ProcedureTemplate } from "@/lib/procedures";
import { ProcedureGallery } from "./procedure-gallery";
import { IconPickerPopover } from "./icon-picker";
import { AutosizeTextarea } from "./ui/autosize-textarea";
import { WorkspaceDialogs, useWorkspaceDialogs } from "./workspace-dialogs";
import { Menu, MenuItem, MenuSeparator, Popup } from "./ui/menu";
import { useWorkspace } from "@/lib/use-workspace";
import { id } from "@/lib/utils";
import { duplicatePageSubtree } from "@/lib/pages";
import { SEED_IDS } from "@/lib/seed";
import { breadcrumbs, movePageTo, placementOf, trashPage } from "@/lib/tree";
import type { Page, DbRecord, RecordOpenMode, WorkspaceState } from "@/lib/types";
import { DatabaseView, RecordProperties } from "./database/DatabaseView";
const DocumentEditor = dynamic(
  () => import("./editor/DocumentEditor").then((m) => m.DocumentEditor),
  {
    ssr: false,
    loading: () => <div className="editor-loading">Opening your page…</div>,
  },
);
function download(name: string, content: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
type StarterView = "table" | "board" | "list";
/** The rows a fresh database needs: itself, a title and status property, one view. */
function databaseScaffold(
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
      name:
        viewType === "table"
          ? "Table"
          : viewType === "board"
            ? "Board"
            : "List",
      type: viewType,
      filters: [],
      sorts: [],
      hidden_properties: [],
    },
  };
}
/** Whether this page is a record of a database that opens its records as full pages. */
function opensAsPage(state: WorkspaceState, pageId: string) {
  const record = state.records.find((r) => r.page_id === pageId);
  if (!record) return false;
  return state.databases.find((d) => d.id === record.database_id)?.open_mode === "page";
}
function withDatabase(
  s: WorkspaceState,
  made: ReturnType<typeof databaseScaffold>,
): Pick<WorkspaceState, "databases" | "properties" | "views"> {
  return {
    databases: [...s.databases, made.database],
    properties: [...s.properties, ...made.properties],
    views: [...s.views, made.view],
  };
}

export function WorkspaceApp() {
  const dialogs = useWorkspaceDialogs();
  const { state, change, ready, status, error, recovery, retry, isDemo } =
    useWorkspace();
  const [activeId, setActiveId] = useState(SEED_IDS.ledger);
  const [search, setSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(
    new Set([SEED_IDS.hub, SEED_IDS.log]),
  );
  const [recordId, setRecordId] = useState<string | null>(null);
  const [describing, setDescribing] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [demoCardHidden, setDemoCardHidden] = useState(false);
  /** A record opens in a side peek; "Open as full page" switches to this. */
  const [recordAsPage, setRecordAsPage] = useState(false);
  /**
   * A record opened from a database embedded in a page: it peeks over that page
   * (like Notion) instead of navigating away to the database's own page.
   */
  const [peekRecordId, setPeekRecordId] = useState<string | null>(null);
  /** A database just created in a page: its name opens for typing once. */
  const [freshDatabase, setFreshDatabase] = useState<string | null>(null);
  const clearFreshDatabase = useCallback(() => setFreshDatabase(null), []);
  /** A freshly created page whose title should take focus. */
  const [focusTitle, setFocusTitle] = useState<string | null>(null);
  /** The playbook / runbook gallery, open for the current page when set. */
  const [procedureKind, setProcedureKind] = useState<ProcedureKind | null>(null);
  /** Set when the gallery was opened from "/playbook" or "/runbook" in the editor. */
  const procedureInsert = useRef<((markdown: string) => void) | null>(null);
  const insertProcedure = useCallback(
    (kind: ProcedureKind, insert: (markdown: string) => void) => {
      procedureInsert.current = insert;
      setProcedureKind(kind);
    },
    [],
  );
  /** The icon picker popover anchored at the open page's icon. */
  const [iconPicker, setIconPicker] = useState(false);
  const remember = useCallback((pageId: string) => {
    if (pageId)
      setRecent((ids) =>
        [pageId, ...ids.filter((id) => id !== pageId)].slice(0, 12),
      );
  }, []);
  const record = state.records.find(
    (r) => r.id === recordId || r.page_id === activeId,
  );
  const recordPage = state.pages.find((p) => p.id === record?.page_id);
  const recordParent = state.pages.find(
    (p) => p.database_id === record?.database_id,
  );
  const page =
    (record
      ? recordAsPage
        ? recordPage
        : recordParent
      : state.pages.find(
          (p) =>
            p.id === activeId &&
            !p.deleted_at &&
            p.workspace_id === state.active_workspace_id,
        )) ||
    state.pages.find(
      (p) =>
        p.workspace_id === state.active_workspace_id &&
        !p.deleted_at &&
        !state.records.some((r) => r.page_id === p.id),
    );
  const chain = page ? breadcrumbs(state.pages, page.id) : [];
  // Reveal the open page in the sidebar tree: expand every page above it. (A record's
  // breadcrumbs end at its database page, which is what the tree shows for it.)
  const revealKey = chain
    .slice(0, -1)
    .map((ancestor) => ancestor.id)
    .join(",");
  useEffect(() => {
    if (!revealKey) return;
    const ids = revealKey.split(",");
    queueMicrotask(() =>
      setExpanded((current) =>
        ids.every((id) => current.has(id)) ? current : new Set([...current, ...ids]),
      ),
    );
  }, [revealKey]);
  const tabTitle = record
    ? recordPage?.title || "Untitled"
    : page
      ? page.title || "Untitled"
      : "";
  /**
   * Scroll memory per history entry, like a browser: Back/Forward return to where you
   * were reading; opening a page fresh starts at the top.
   */
  const scrollMemory = useRef(new Map<string, number>());
  const entryKey = useRef("");
  const restoreScroll = useRef<number | null>(null);
  const pageScrollRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // On first load the workspace arrives after routing: apply the setting then too.
  useEffect(() => {
    if (!ready) return;
    const asPage = opensAsPage(stateRef.current, activeId);
    if (asPage) queueMicrotask(() => setRecordAsPage(true));
    // Only when the workspace first becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const open = useCallback(
    (pageId: string, push = true) => {
      if (!pageId) return;
      const rec = state.records.find((r) => r.page_id === pageId);
      setActiveId(pageId);
      setRecordId(rec?.id || null);
      setRecordAsPage(false);
      setPeekRecordId(null);
      setFocusTitle(null);
      setIconPicker(false);
      remember(pageId);
      // Re-opening the page you're on doesn't add a history entry (Back would seem dead).
      if (push && window.history.state?.pageId !== pageId) {
        entryKey.current = id();
        restoreScroll.current = 0;
        window.history.pushState({ pageId, key: entryKey.current }, "", `/p/${pageId}`);
      }
      if (window.innerWidth < 760) setCollapsed(true);
    },
    [state.records, remember],
  );
  useEffect(() => {
    const route = () => {
      // Back/Forward (and the first load): pick up this entry's scroll position.
      const state = window.history.state as { pageId?: string; key?: string } | null;
      if (!state?.key) {
        const key = id();
        window.history.replaceState({ ...state, key }, "");
        entryKey.current = key;
      } else entryKey.current = state.key;
      restoreScroll.current = scrollMemory.current.get(entryKey.current) ?? 0;
      const path = window.location.pathname.match(/^\/p\/([^/]+)/);
      const q = new URLSearchParams(window.location.search).get("page");
      setActiveId(path?.[1] || q || SEED_IDS.ledger);
      setRecordId(null);
      setPeekRecordId(null);
      // A record whose database opens records as full pages comes back as one.
      setRecordAsPage(opensAsPage(stateRef.current, path?.[1] || q || ""));
      if (path?.[1] || q) remember(path?.[1] || q || "");
    };
    queueMicrotask(route);
    window.addEventListener("popstate", route);
    queueMicrotask(() => {
      try {
        const prefs = JSON.parse(
          localStorage.getItem("slate-preferences") || "{}",
        );
        if (prefs.expanded) setExpanded(new Set(prefs.expanded));
        if (prefs.collapsed || window.innerWidth < 760) setCollapsed(true);
        if (Array.isArray(prefs.recent))
          setRecent((ids) =>
            [...new Set([...ids, ...prefs.recent])].slice(0, 12),
          );
        if (prefs.demoCardHidden) setDemoCardHidden(true);
      } catch {}
    });
    return () => window.removeEventListener("popstate", route);
  }, [remember]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        "slate-preferences",
        JSON.stringify({
          expanded: [...expanded],
          collapsed,
          recent,
          demoCardHidden,
        }),
      );
    } catch {}
  }, [expanded, collapsed, recent, demoCardHidden, ready]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setCollapsed((s) => !s);
      }
      // ⌘[ / ⌘] go back and forward, like Notion. Editors that use these keys (the
      // Markdown source indents with them) handle them first.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !e.defaultPrevented) {
        if (e.key === "[") {
          e.preventDefault();
          window.history.back();
        } else if (e.key === "]") {
          e.preventDefault();
          window.history.forward();
        }
      }
      if (e.key === "Escape") setRecordId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  // Restore the remembered position once the page has rendered. Its content (the
  // editor, databases) can take a few frames to reach full height, so retry briefly.
  useLayoutEffect(() => {
    const target = restoreScroll.current;
    if (target === null || !ready) return;
    restoreScroll.current = null;
    let frame = 0;
    let tries = 0;
    const apply = () => {
      const el = pageScrollRef.current;
      if (!el) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 1 && ++tries < 20)
        frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [activeId, ready]);
  const patchPage = (pageId: string, patch: Partial<Page>) =>
    change((current) => {
      const before = current.pages.find((p) => p.id === pageId);
      // Moving a page moves its block from the old parent's page to the new one's.
      const s =
        before &&
        patch.parent_id !== undefined &&
        patch.parent_id !== before.parent_id
          ? relinkPageBlock(current, pageId, before.parent_id, patch.parent_id)
          : current;
      return {
        ...s,
        pages: s.pages.map((p) =>
          p.id === pageId
            ? { ...p, ...patch, updated_at: new Date().toISOString() }
            : p,
        ),
        databases: s.databases.map((d) =>
          d.page_id === pageId && patch.title !== undefined
            ? { ...d, name: patch.title }
            : d,
        ),
        records: s.records.map((r) => {
          if (r.page_id !== pageId || patch.title === undefined) return r;
          const titleProp = s.properties.find(
            (p) => p.database_id === r.database_id && p.type === "title",
          );
          return titleProp
            ? { ...r, values: { ...r.values, [titleProp.id]: patch.title } }
            : r;
        }),
      };
    });
  /**
   * `linkInParent` adds the new page's block to its parent's page (sidebar "+");
   * the slash command inserts its own block where the cursor is, so it passes false.
   */
  const createPage = (
    parent: string | null,
    title = "Untitled",
    kind: "document" | "database" = "document",
    linkInParent = false,
    viewType: StarterView = "table",
  ) => {
    const pageId = id(),
      databaseId = kind === "database" ? id() : undefined,
      now = new Date().toISOString();
    change((s) => {
      const next: WorkspaceState = {
        ...s,
        pages: [
          ...s.pages,
          {
            id: pageId,
            workspace_id: s.active_workspace_id,
            parent_id: parent,
            title,
            icon: "",
            kind,
            database_id: databaseId,
            description: "",
            position: s.pages.filter((p) => p.parent_id === parent).length,
            favorite: false,
            deleted_at: null,
            created_at: now,
            updated_at: now,
          },
        ],
        documents: [
          ...s.documents,
          { page_id: pageId, markdown: "", updated_at: now },
        ],
        ...(databaseId
          ? withDatabase(
              s,
              databaseScaffold(
                databaseId,
                pageId,
                s.active_workspace_id,
                title,
                viewType,
              ),
            )
          : {}),
      };
      return linkInParent && parent
        ? relinkPageBlock(next, pageId, null, parent)
        : next;
    });
    if (parent) setExpanded((s) => new Set([...s, parent]));
    return { pageId, databaseId };
  };
  /** A brand-new page: nothing written, no children, not a database record. */
  const isBlankDocument = (p: Page) =>
    p.kind === "document" &&
    !state.records.some((r) => r.page_id === p.id) &&
    !(state.documents.find((d) => d.page_id === p.id)?.markdown || "").trim() &&
    !state.pages.some((child) => child.parent_id === p.id && !child.deleted_at);
  /** Turns an empty document into a database with the chosen first view. */
  const convertToDatabase = (pageId: string, viewType: StarterView) => {
    const databaseId = id();
    change((s) => {
      const target = s.pages.find((p) => p.id === pageId);
      if (!target || target.kind !== "document") return s;
      return {
        ...s,
        pages: s.pages.map((p) =>
          p.id === pageId
            ? {
                ...p,
                kind: "database",
                database_id: databaseId,
                updated_at: new Date().toISOString(),
              }
            : p,
        ),
        ...withDatabase(
          s,
          databaseScaffold(
            databaseId,
            pageId,
            target.workspace_id,
            target.title,
            viewType,
          ),
        ),
      };
    });
  };
  /**
   * Fills an empty page from a playbook or runbook template. What the person already
   * typed (title, icon, description) is kept; the rest comes from the template.
   */
  const applyProcedure = (pageId: string, template: ProcedureTemplate) => {
    const now = new Date().toISOString();
    const markdown = templateMarkdown(template);
    change((s) => ({
      ...s,
      pages: s.pages.map((p) =>
        p.id === pageId
          ? {
              ...p,
              title: p.title.trim() ? p.title : template.name,
              icon: p.icon || template.icon,
              description: p.description.trim() ? p.description : template.whenToUse,
              updated_at: now,
            }
          : p,
      ),
      documents: s.documents.some((d) => d.page_id === pageId)
        ? s.documents.map((d) =>
            d.page_id === pageId ? { ...d, markdown, updated_at: now } : d,
          )
        : [...s.documents, { page_id: pageId, markdown, updated_at: now }],
    }));
  };
  /** Like Notion: a new page opens immediately with the cursor in its title. */
  const requestNew = (
    parent?: string | null,
    kind: "document" | "database" = "document",
  ) => {
    const made = createPage(parent ?? null, "", kind, true);
    open(made.pageId);
    setFocusTitle(made.pageId);
  };
  const action = (action: PageAction, p: Page) => {
    if (action === "rename") dialogs.renamePage(p);
    // The open page gets the picker right at its icon; other pages use the dialog.
    if (action === "icon") {
      if (p.id === page?.id) {
        // The picker anchors to the header icon, so bring the header into view first.
        document
          .querySelector(".page-header-top")
          ?.scrollIntoView({ block: "nearest" });
        setIconPicker(true);
      } else dialogs.pageIcon(p);
    }
    if (action === "favorite") {
      patchPage(p.id, { favorite: !p.favorite });
      toast(p.favorite ? "Removed from favorites" : "Added to favorites");
    }
    if (action === "trash") {
      change((s) => trashPage(s, p.id));
      toast("Page moved to trash", {
        action: {
          label: "Undo",
          onClick: () => change((s) => trashPage(s, p.id, true)),
        },
      });
    }
    if (action === "move") dialogs.movePage(p);
    if (action === "duplicate") {
      const copyId = id();
      change((s) => {
        const copied = duplicatePageSubtree(s, p.id, { rootId: copyId });
        // The copy sits next to the original, so it gets a block in the same parent.
        return p.parent_id
          ? relinkPageBlock(copied, copyId, null, p.parent_id)
          : copied;
      });
      open(copyId);
      toast("Page duplicated");
    }
  };
  /** Undo in each open editor (by page), so a toast's "Undo" can reach it. */
  const editorUndo = useRef(new Map<string, () => void>());
  const registerHistory = useCallback(
    (pageId: string, api: { undo: () => void } | null) => {
      if (api) editorUndo.current.set(pageId, api.undo);
      else editorUndo.current.delete(pageId);
    },
    [],
  );
  /** The markdown each page last saved, to notice databases added or removed. */
  const lastMarkdown = useRef(new Map<string, string>());
  const saveMarkdown = (pageId: string, markdown: string) => {
    const before =
      lastMarkdown.current.get(pageId) ??
      state.documents.find((d) => d.page_id === pageId)?.markdown ??
      "";
    lastMarkdown.current.set(pageId, markdown);
    const was = databaseIdsIn(before);
    const now = databaseIdsIn(markdown);
    const removed = was.filter((dbId) => !now.includes(dbId));
    const added = now.filter((dbId) => !was.includes(dbId));
    const pageOf = (dbId: string) => state.pages.find((p) => p.database_id === dbId);
    // A database made in this page goes with its block: removing the block moves it to
    // the Trash; bringing the block back (Undo, ⌘Z) restores it. Linked views of other
    // pages' databases are just views: removing one leaves the database alone.
    const owned = (dbId: string) => pageOf(dbId)?.parent_id === pageId;
    const trash = removed.filter((dbId) => owned(dbId) && !pageOf(dbId)?.deleted_at);
    const restore = added.filter((dbId) => owned(dbId) && pageOf(dbId)?.deleted_at);
    saveDocument(pageId, markdown, trash.map((dbId) => pageOf(dbId)!.id), restore.map((dbId) => pageOf(dbId)!.id));
    for (const dbId of trash) {
      const name = pageOf(dbId)?.title || "Untitled";
      toast(`“${name}” moved to Trash`, {
        action: { label: "Undo", onClick: () => editorUndo.current.get(pageId)?.() },
      });
    }
    for (const dbId of removed.filter((dbId) => !owned(dbId))) {
      const name = pageOf(dbId)?.title || "Untitled";
      toast(`Removed the view of “${name}”. The database itself is unchanged.`);
    }
  };
  const saveDocument = (
    pageId: string,
    markdown: string,
    trashIds: string[] = [],
    restoreIds: string[] = [],
  ) =>
    change((current) => {
      let s = current;
      for (const id of trashIds) s = trashPage(s, id);
      for (const id of restoreIds) s = trashPage(s, id, true);
      return {
      ...s,
      documents: s.documents.some((d) => d.page_id === pageId)
        ? s.documents.map((d) =>
            d.page_id === pageId
              ? { ...d, markdown, updated_at: new Date().toISOString() }
              : d,
          )
        : [
            ...s.documents,
            { page_id: pageId, markdown, updated_at: new Date().toISOString() },
          ],
      };
    });
  /** A database's choice of how its records open: side panel (default) or full page. */
  const recordOpenMode = (r: DbRecord): RecordOpenMode =>
    state.databases.find((d) => d.id === r.database_id)?.open_mode ?? "peek";
  const openRecordAsPage = (r: DbRecord) => {
    open(r.page_id);
    setRecordAsPage(true);
  };
  /** From a database page: peek over it, or (per the setting, or ⌘-click) go full page. */
  const openRecord = (r: DbRecord, options?: { fullPage?: boolean }) =>
    options?.fullPage || recordOpenMode(r) === "page"
      ? openRecordAsPage(r)
      : open(r.page_id);
  /** Databases this page could show as a linked view: everything in the workspace. */
  const databaseChoices = (hostId: string) =>
    state.databases
      .filter((db) => db.workspace_id === state.active_workspace_id)
      .map((db) => ({
        db,
        page: state.pages.find((p) => p.id === db.page_id && !p.deleted_at),
      }))
      .filter(({ page }) => page && page.id !== hostId)
      .map(({ db, page }) => ({
        id: db.id,
        name: page!.title || db.name,
        page: page!,
        path: breadcrumbs(state.pages, page!.id)
          .slice(0, -1)
          .map((ancestor) => ancestor.title || "Untitled")
          .join(" / "),
        records: state.records.filter((r) => r.database_id === db.id).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  /**
   * Links a database into a page: the new block gets its own copies of the database's
   * views, so filters, sorts and layout there don't change the original or other pages.
   * Rows and properties stay shared.
   */
  const linkDatabase = (databaseId: string) => {
    const block = id();
    change((s) => ({ ...s, views: [...s.views, ...placementViews(s, databaseId, block)] }));
    return block;
  };
  /** The page a database really lives in, when it's shown somewhere else. */
  const linkedFrom = (databaseId: string, hostId: string) => {
    const page = state.pages.find((p) => p.database_id === databaseId);
    if (!page || page.parent_id === hostId) return undefined;
    const parent = state.pages.find((p) => p.id === page.parent_id);
    return parent?.title || (parent ? "Untitled" : "Private pages");
  };
  /** Rows of an embedded database open in a side peek over the current page. */
  const peekRecord = (r: DbRecord, options?: { fullPage?: boolean }) =>
    options?.fullPage || recordOpenMode(r) === "page"
      ? openRecordAsPage(r)
      : setPeekRecordId(r.id);
  const peeked = peekRecordId
    ? state.records.find((r) => r.id === peekRecordId)
    : undefined;
  const peekedPage = state.pages.find(
    (p) => p.id === peeked?.page_id && !p.deleted_at,
  );
  const peekedParent = state.pages.find(
    (p) => p.database_id === peeked?.database_id,
  );
  const editor = (p: Page) => (
    <DocumentEditor
      key={p.id}
      pageId={p.id}
      markdown={state.documents.find((d) => d.page_id === p.id)?.markdown || ""}
      onChange={(md) => saveMarkdown(p.id, md)}
      onCreatePage={() => {
        const made = createPage(p.id, "");
        toast("Nested page created");
        return made.pageId;
      }}
      onCreateDatabase={(viewType) => {
        // Starts unnamed; its name field is focused right away (see freshDatabase).
        const made = createPage(p.id, "", "database", false, viewType);
        setFreshDatabase(made.databaseId!);
        return made.databaseId!;
      }}
      listDatabases={() => databaseChoices(p.id)}
      onLinkDatabase={linkDatabase}
      onInsertProcedure={insertProcedure}
      onHistoryApi={registerHistory}
      onOpenPage={open}
      resolvePage={(pageId) =>
        state.pages.find((item) => item.id === pageId && !item.deleted_at)
      }
      onUploadImage={
        isDemo
          ? undefined
          : async (file) => {
              await retry();
              const { uploadImage } = await import("@/lib/attachments");
              return uploadImage(file, p.id, p.workspace_id);
            }
      }
      renderDatabase={(db, block) => (
        <DatabaseView
          databaseId={db}
          state={state}
          onChange={change}
          onOpenRecord={peekRecord}
          onOpenPage={open}
          linkedFrom={linkedFrom(db, p.id)}
          placement={block}
          autoFocusTitle={freshDatabase === db}
          onTitleFocused={clearFreshDatabase}
          compact
        />
      )}
    />
  );
  /** A sidebar drag: put the page exactly where the drop line showed, with Undo. */
  const movePage = (pageId: string, parentId: string | null, index: number) => {
    const page = state.pages.find((p) => p.id === pageId);
    const before = placementOf(state.pages, pageId);
    if (!page || !before) return;
    const relocate = (to: string | null, at: number) =>
      change((s) => {
        const from = s.pages.find((p) => p.id === pageId)?.parent_id ?? null;
        const moved = movePageTo(s, pageId, to, at);
        // Changing parent moves the page's block in the parents' text too.
        return from === to ? moved : relinkPageBlock(moved, pageId, from, to);
      });
    if (before.parentId === parentId && before.index === index) return;
    relocate(parentId, index);
    if (parentId) setExpanded((s) => new Set([...s, parentId]));
    if (before.parentId === parentId) return; // A reorder: obvious, no toast.
    const destination = state.pages.find((p) => p.id === parentId);
    toast(`Moved to ${destination ? destination.title || "Untitled" : "Private pages"}`, {
      action: { label: "Undo", onClick: () => relocate(before.parentId, before.index) },
    });
  };
  const workspaceSwitch = (workspaceId: string) => {
    change((s) => ({ ...s, active_workspace_id: workspaceId }));
    const first = state.pages.find(
      (p) => p.workspace_id === workspaceId && !p.deleted_at,
    );
    if (first) open(first.id);
  };
  return (
    <div className="workspace-app">
      {/* React hoists this into <head>; it follows the open page or record. */}
      <title>{ready && tabTitle ? `${tabTitle} · Slate` : "Slate"}</title>
      {/* Screen readers hear page switches (the app swaps pages without a reload). */}
      <div className="sr-only" role="status" aria-live="polite">
        {ready && tabTitle ? `${tabTitle}` : ""}
      </div>
      <Sidebar
        state={state}
        activeId={page?.id || activeId}
        expanded={expanded}
        collapsed={collapsed}
        isDemo={isDemo}
        onToggle={() => setCollapsed((v) => !v)}
        onOpen={open}
        onExpand={(pageId) =>
          setExpanded((s) => {
            const n = new Set(s);
            if (n.has(pageId)) n.delete(pageId);
            else n.add(pageId);
            return n;
          })
        }
        onNew={requestNew}
        onPageAction={action}
        onWorkspace={workspaceSwitch}
        onCreateWorkspace={dialogs.newWorkspace}
        onSearch={() => setSearch(true)}
        onSettings={dialogs.settings}
        onTrash={dialogs.trash}
        onMovePage={movePage}
        recentIds={recent}
        onDismissDemoCard={
          demoCardHidden ? undefined : () => setDemoCardHidden(true)
        }
      />
      {!collapsed && (
        <button
          className="sidebar-scrim"
          aria-label="Close sidebar"
          tabIndex={-1}
          onClick={() => setCollapsed(true)}
        />
      )}
      <div className="main-pane">
        <header className="topbar">
          <div className="topbar-left">
            {collapsed && (
              <button
                className="icon-button"
                onClick={() => setCollapsed(false)}
                aria-label="Show sidebar"
              >
                <PanelLeft size={18} />
              </button>
            )}
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              {chain.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && <span className="breadcrumb-separator">/</span>}
                  <button onClick={() => open(p.id)} title={p.title}>
                    <PageIcon page={p} size={16} fallback={null} />
                    <span>{p.title || "Untitled"}</span>
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <div className="topbar-actions">
            <span
              className={`save-status ${status}`}
              title={
                isDemo
                  ? "Saved in this browser. Configure Supabase to sync your workspace."
                  : status === "saved"
                    ? "All changes saved"
                    : "Saving your changes"
              }
            >
              {status === "saved" ? (
                <Check size={12} />
              ) : status === "error" ? (
                <CloudOff size={14} />
              ) : (
                <Cloud size={14} />
              )}
              <span>
                {status === "saved"
                  ? "Saved"
                  : status === "saving"
                    ? "Saving…"
                    : "Save failed"}
              </span>
            </span>
            <Popup
              align="end"
              trigger={
                <button className="private-button">
                  <Lock size={14} />
                  <span>Private</span>
                </button>
              }
            >
              <div className="privacy-popover">
                <Lock size={20} />
                <strong>Just for you</strong>
                <p>
                  This page belongs to your private workspace. Only you can
                  access it.
                </p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    void navigator.clipboard.writeText(window.location.href);
                    toast.success("Private page link copied");
                  }}
                >
                  <Copy size={14} />
                  Copy page link
                </button>
              </div>
            </Popup>
            {page && (
              <>
                <button
                  className={`icon-button favorite-button ${page.favorite ? "is-favorite" : ""}`}
                  aria-label={
                    page.favorite ? "Remove from favorites" : "Add to favorites"
                  }
                  onClick={() => action("favorite", page)}
                >
                  <Star
                    size={18}
                    fill={page.favorite ? "currentColor" : "none"}
                  />
                </button>
                <Menu
                  align="end"
                  trigger={
                    <button className="icon-button" aria-label="Page options">
                      <MoreHorizontal size={20} />
                    </button>
                  }
                >
                  <PageActions page={page} onAction={action} />
                  <MenuSeparator />
                  <MenuItem
                    onClick={() => {
                      download(
                        `${page.title}.md`,
                        `# ${page.title}\n\n${page.description}\n\n${state.documents.find((d) => d.page_id === page.id)?.markdown || ""}`,
                      );
                      toast.success("Markdown exported");
                    }}
                  >
                    <Download />
                    Export Markdown
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      void navigator.clipboard.writeText(window.location.href);
                      toast.success("Page link copied");
                    }}
                  >
                    <Copy />
                    Copy page link
                  </MenuItem>
                </Menu>
              </>
            )}
          </div>
        </header>
        {error && (
          <div className="save-error">
            <CloudOff size={16} />
            <span>{error}</span>
            {recovery && (
              <button
                onClick={() =>
                  download(
                    "slate-unsynced-draft.json",
                    JSON.stringify(recovery, null, 2),
                    "application/json",
                  )
                }
              >
                Download draft
              </button>
            )}
            <button onClick={() => void retry()}>Retry</button>
          </div>
        )}
        <main
          className={`page-scroll ${page?.kind === "database" ? "database-page" : "document-page"}`}
          key={activeId}
          ref={pageScrollRef}
          onScroll={(e) =>
            scrollMemory.current.set(entryKey.current, e.currentTarget.scrollTop)
          }
        >
          {!ready ? (
            <div className="workspace-loading">
              <BrandMark size={40} />
              <span>Opening your workspace…</span>
            </div>
          ) : page ? (
            <article className="page-content">
              <IconPickerPopover
                open={iconPicker}
                onOpenChange={setIconPicker}
                value={page.icon}
                onChange={(icon) => patchPage(page.id, { icon })}
              >
                <div className="page-header-top">
                  <div className="page-quiet-actions">
                    {parsePageIcon(page.icon).kind === "none" && (
                      <button onClick={() => setIconPicker(true)}>
                        <SmilePlus size={14} />
                        Add icon
                      </button>
                    )}
                    {!page.description && describing !== page.id && (
                      <button onClick={() => setDescribing(page.id)}>
                        <AlignLeft size={14} />
                        Add description
                      </button>
                    )}
                  </div>
                  {parsePageIcon(page.icon).kind !== "none" && (
                    <button
                      className={`document-icon ${iconPicker ? "is-open" : ""}`}
                      onClick={() => setIconPicker(true)}
                      aria-label="Change page icon"
                      title="Change icon"
                    >
                      <PageIcon
                        page={page}
                        size={page.kind === "database" ? 48 : 72}
                        fallback={null}
                      />
                    </button>
                  )}
                </div>
              </IconPickerPopover>
              <AutosizeTextarea
                className="page-title"
                aria-label="Page title"
                rows={1}
                value={page.title}
                placeholder="Untitled"
                autoFocus={focusTitle === page.id}
                onChange={(e) => {
                  patchPage(page.id, { title: e.target.value });
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  // Like a document heading: Enter continues into the page body.
                  if (page.kind === "document")
                    e.currentTarget
                      .closest(".page-content")
                      ?.querySelector<HTMLElement>(".page-body .ProseMirror")
                      ?.focus();
                }}
              />
              {(page.description || describing === page.id) && (
                <AutosizeTextarea
                  className="page-description"
                  aria-label="Page description"
                  placeholder="Add a description…"
                  autoFocus={describing === page.id && !page.description}
                  value={page.description}
                  rows={1}
                  onChange={(e) =>
                    patchPage(page.id, { description: e.target.value })
                  }
                  onBlur={(e) => {
                    if (!e.target.value.trim()) {
                      if (page.description)
                        patchPage(page.id, { description: "" });
                      setDescribing(null);
                    }
                  }}
                />
              )}
              <div className="page-body">
                {page.kind === "database" && page.database_id ? (
                  <DatabaseView
                    databaseId={page.database_id}
                    state={state}
                    onChange={change}
                    onOpenRecord={openRecord}
                  />
                ) : (
                  <>
                    {record && recordAsPage && record.page_id === page.id && (
                      <RecordProperties
                        record={record}
                        state={state}
                        onChange={change}
                        onOpenRecord={openRecord}
                      />
                    )}
                    {isBlankDocument(page) && (
                      <div
                        className="page-starter"
                        aria-label="Start this page"
                      >
                        <p>
                          Press <kbd>↵</kbd> to start writing, or begin with
                        </p>
                        <div className="page-starter-options">
                          <button
                            onClick={(e) =>
                              e.currentTarget
                                .closest(".page-content")
                                ?.querySelector<HTMLElement>(
                                  ".page-body .ProseMirror",
                                )
                                ?.focus()
                            }
                          >
                            <FileText size={16} />
                            Empty page
                          </button>
                          <span className="page-starter-divider" aria-hidden />
                          {/* The three layouts all make a database: the label says so,
                              the icons tell them apart. */}
                          <span
                            className="page-starter-group"
                            role="group"
                            aria-label="Database"
                          >
                            <span className="page-starter-label" aria-hidden>
                              Database
                            </span>
                            {(
                              [
                                ["table", Table2, "Table"],
                                ["board", KanbanSquare, "Board"],
                                ["list", List, "List"],
                              ] as const
                            ).map(([type, Icon, label]) => (
                              <button
                                key={type}
                                title={`Turn this page into a database shown as a ${label.toLowerCase()}`}
                                onClick={() => convertToDatabase(page.id, type)}
                              >
                                <Icon size={16} />
                                {label}
                              </button>
                            ))}
                          </span>
                          <span className="page-starter-divider" aria-hidden />
                          <span
                            className="page-starter-group"
                            role="group"
                            aria-label="Template"
                          >
                            <span className="page-starter-label" aria-hidden>
                              Template
                            </span>
                            <button
                              title="Start from a playbook: a guided procedure in phases"
                              onClick={() => setProcedureKind("playbook")}
                            >
                              <Compass size={16} />
                              Playbook
                            </button>
                            <button
                              title="Start from a runbook: steps for a repeatable operation"
                              onClick={() => setProcedureKind("runbook")}
                            >
                              <ClipboardList size={16} />
                              Runbook
                            </button>
                          </span>
                        </div>
                      </div>
                    )}
                    {editor(page)}
                    {(() => {
                      // Subpages show as blocks inside the page. Any child without one
                      // (older pages, imports) is listed here so it is never hidden.
                      const markdown =
                        state.documents.find((d) => d.page_id === page.id)
                          ?.markdown || "";
                      const unplaced = state.pages
                        .filter(
                          (p) =>
                            p.parent_id === page.id &&
                            !p.deleted_at &&
                            !state.records.some((r) => r.page_id === p.id) &&
                            !isShownInPage(markdown, p),
                        )
                        .sort((a, b) => a.position - b.position);
                      if (!unplaced.length) return null;
                      return (
                        <section className="pages-inside" aria-label="Pages inside">
                          <div className="pages-inside-head">
                            <span>Pages inside</span>
                            <button
                              onClick={() =>
                                change((s) =>
                                  unplaced.reduce(
                                    (acc, child) =>
                                      relinkPageBlock(acc, child.id, null, page.id),
                                    s,
                                  ),
                                )
                              }
                              title="Add these pages as blocks at the end of the page"
                            >
                              Add to page
                            </button>
                          </div>
                          {unplaced.map((p) => (
                            <button
                              key={p.id}
                              className="editor-page-reference"
                              onClick={() => open(p.id)}
                            >
                              <PageIcon page={p} size={18} />
                              <span className={p.title ? "" : "is-untitled"}>
                                {p.title || "Untitled"}
                              </span>
                              {/* Same chevron as page blocks in the text: it opens the page. */}
                              <ChevronRight size={16} />
                            </button>
                          ))}
                        </section>
                      );
                    })()}
                  </>
                )}
              </div>
            </article>
          ) : (
            <div className="empty-workspace">
              <FileText size={36} />
              <h2>A little room to think.</h2>
              <p>Start with a page to write in, or a database to organize.</p>
              <div className="empty-workspace-actions">
                <button
                  className="primary-button"
                  onClick={() => requestNew(null)}
                >
                  <FileText size={16} />
                  New page
                </button>
                <button
                  className="secondary-button"
                  onClick={() => requestNew(null, "database")}
                >
                  <Table2 size={16} />
                  New database
                </button>
              </div>
            </div>
          )}
        </main>
        {collapsed && (
          <ShortcutsPopover
            trigger={
              <button
                className="help-button"
                aria-label="Help and keyboard shortcuts"
              >
                <HelpCircle size={18} />
              </button>
            }
          />
        )}
      </div>
      {search && (
        <SearchDialog
          open={search}
          onClose={() => setSearch(false)}
          state={state}
          onOpen={open}
          recentIds={recent}
          currentId={page?.id || activeId}
        />
      )}
      <ProcedureGallery
        kind={procedureKind}
        onKindChange={setProcedureKind}
        onClose={() => {
          setProcedureKind(null);
          procedureInsert.current = null;
        }}
        onUse={(template) => {
          setProcedureKind(null);
          // From the slash menu: add the template where it was typed (⌘Z undoes it).
          const insert = procedureInsert.current;
          procedureInsert.current = null;
          if (insert) {
            insert(templateMarkdown(template));
            return;
          }
          if (!page) return;
          applyProcedure(page.id, template);
          toast(`Started from “${template.name}”`, {
            action: {
              label: "Undo",
              onClick: () => {
                const before = state.pages.find((p) => p.id === page.id);
                const beforeMarkdown =
                  state.documents.find((d) => d.page_id === page.id)?.markdown ?? "";
                change((s) => ({
                  ...s,
                  pages: s.pages.map((p) =>
                    p.id === page.id && before
                      ? { ...p, title: before.title, icon: before.icon, description: before.description }
                      : p,
                  ),
                  documents: s.documents.map((d) =>
                    d.page_id === page.id ? { ...d, markdown: beforeMarkdown } : d,
                  ),
                }));
              },
            },
          });
        }}
      />
      <WorkspaceDialogs
        controller={dialogs}
        state={state}
        change={change}
        isDemo={isDemo}
        patchPage={patchPage}
        expandPage={(pageId) =>
          setExpanded((current) => new Set([...current, pageId]))
        }
        onWorkspaceCreated={() => setActiveId("")}
        {...(peeked && peekedPage
          ? {
              record: peeked,
              recordPage: peekedPage,
              recordParent: peekedParent,
              closeRecord: () => setPeekRecordId(null),
              // Full page: navigate to the record and show it as a page.
              expandRecord: () => {
                open(peeked.page_id);
                setRecordAsPage(true);
              },
              peekOpen: true,
            }
          : {
              record,
              recordPage,
              recordParent,
              closeRecord: () => {
                if (recordParent) open(recordParent.id);
              },
              expandRecord: () => setRecordAsPage(true),
              peekOpen: !recordAsPage,
            })}
        openRecord={openRecord}
        openPage={open}
        renderEditor={editor}
      />
    </div>
  );
}
