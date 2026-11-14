"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Brand } from "./brand";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  MoreHorizontal,
  Search,
  House,
  FileText,
  PanelLeftClose,
  Settings,
  Trash2,
  Check,
  Star,
  GripVertical,
  Copy,
  Pencil,
  FolderInput,
  SquarePen,
  CircleHelp,
  HardDrive,
  X,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragMoveEvent,
  type Modifier,
} from "@dnd-kit/core";
import { dropPlacement, type DropZone } from "@/lib/tree";
import type { Page, WorkspaceState } from "@/lib/types";
import { Menu, MenuItem, MenuSeparator } from "./ui/menu";
import { ShortcutsPopover } from "./shortcuts";
import { PageIcon } from "./page-icon";
export type PageAction =
  | "rename"
  | "duplicate"
  | "trash"
  | "move"
  | "favorite"
  | "icon";
interface Props {
  state: WorkspaceState;
  activeId: string;
  expanded: Set<string>;
  collapsed: boolean;
  isDemo: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onExpand: (id: string) => void;
  onNew: (parent?: string | null, kind?: "document" | "database") => void;
  onPageAction: (action: PageAction, page: Page) => void;
  onWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onTrash: () => void;
  /** Moves a page to `index` among `parentId`'s subpages (from a sidebar drag). */
  onMovePage: (pageId: string, parentId: string | null, index: number) => void;
  /** Most recently opened page ids, newest first. */
  recentIds: string[];
  /** Shows the dismissible "local demo" card when set. */
  onDismissDemoCard?: () => void;
}
export function PageActions({
  page,
  onAction,
}: {
  page: Page;
  onAction: Props["onPageAction"];
}) {
  return (
    <>
      <MenuItem onClick={() => onAction("rename", page)}>
        <Pencil />
        Rename
      </MenuItem>
      <MenuItem onClick={() => onAction("icon", page)}>
        <FileText />
        Change icon
      </MenuItem>
      <MenuItem onClick={() => onAction("favorite", page)}>
        <Star />
        {page.favorite ? "Remove from favorites" : "Add to favorites"}
      </MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => onAction("duplicate", page)}>
        <Copy />
        Duplicate
      </MenuItem>
      <MenuItem onClick={() => onAction("move", page)}>
        <FolderInput />
        Move to
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger onClick={() => onAction("trash", page)}>
        <Trash2 />
        Move to trash
      </MenuItem>
    </>
  );
}
/** Fixed sidebar width (it is not resizable). */
export const SIDEBAR_WIDTH = 272;

function TreeRow({
  page,
  depth,
  hasChildren,
  expanded,
  active,
  onOpen,
  onExpand,
  onNew,
  onPageAction,
  recordCount,
  drop,
}: {
  page: Page;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  active: boolean;
  onOpen: () => void;
  onExpand: () => void;
  onNew: () => void;
  onPageAction: Props["onPageAction"];
  /** Records in this database; undefined for documents. */
  recordCount?: number;
  /** Where a page being dragged would land relative to this row. */
  drop?: DropZone | "inside-first";
}) {
  // Keeps the "…" (the menu's anchor) visible while its menu is open; a hidden
  // anchor has no position and the menu would jump to the window corner.
  const [menuOpen, setMenuOpen] = useState(false);
  const name = page.title || "Untitled";
  // The row stays put while dragging (a preview follows the pointer) and is also a
  // drop target; the sidebar works out above / below / inside from the pointer.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: page.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: page.id });
  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      style={{ "--depth": depth } as React.CSSProperties}
      className={`tree-row ${active ? "selected" : ""} ${menuOpen ? "menu-open" : ""} ${isDragging ? "is-dragging" : ""} ${drop ? `drop-${drop}` : ""}`}
      data-page-row={page.id}
    >
      <button
        className="tree-drag"
        aria-label={`Drag ${page.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={12} />
      </button>
      {/* Indent by depth; icons and titles line up whether or not a page has subpages. */}
      <span className="tree-indent" style={{ width: 7 + depth * 16 }} aria-hidden />
      {hasChildren && (
        // Takes the icon's place while the row is pointed at (as in Notion).
        <button
          className="tree-expand"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${page.title}`}
          onClick={onExpand}
          style={{ left: 7 + depth * 16 }}
        >
          <ChevronRight className={expanded ? "rotated" : ""} size={14} />
        </button>
      )}
      <button
        className="tree-page"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        // The whole row drags with the pointer; keyboard dragging stays on the handle.
        onPointerDown={
          listeners?.onPointerDown as
            | React.PointerEventHandler<HTMLButtonElement>
            | undefined
        }
        title={
          recordCount === undefined
            ? name
            : `${name} · Database · ${recordCount} ${recordCount === 1 ? "record" : "records"}`
        }
      >
        <PageGlyph page={page} />
        <span className={`tree-title ${page.title ? "" : "is-untitled"}`}>
          {name}
        </span>
        {recordCount !== undefined && recordCount > 0 && (
          <span className="tree-count" aria-hidden>
            {recordCount}
          </span>
        )}
      </button>
      <span className="tree-actions">
        <Menu
          side="right"
          align="start"
          onOpenChange={setMenuOpen}
          trigger={
            <button
              className="icon-button"
              aria-label={`Actions for ${page.title}`}
            >
              <MoreHorizontal size={16} />
            </button>
          }
        >
          <PageActions page={page} onAction={onPageAction} />
        </Menu>
        <button
          className="icon-button"
          aria-label={`Add a page inside ${page.title}`}
          title="Add a page inside"
          onClick={onNew}
        >
          <Plus size={16} />
        </button>
      </span>
    </div>
  );
}
function PageGlyph({ page }: { page: Page }) {
  return <PageIcon page={page} size={18} />;
}

/**
 * The drag preview sits just below-right of the pointer (like Finder or Notion), so it
 * never covers the drop line or the row it's being dropped on.
 */
const besidePointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent || !("clientX" in activatorEvent)) return transform;
  const pointer = activatorEvent as PointerEvent;
  return {
    ...transform,
    x: transform.x + (pointer.clientX - draggingNodeRect.left) + 12,
    y: transform.y + (pointer.clientY - draggingNodeRect.top) + 10,
  };
};

type SectionId = "favorites" | "recents" | "private";
const SECTIONS_KEY = "slate-sidebar-sections";

/** A sidebar group whose heading folds it away; the choice is remembered. */
function SidebarSection({
  id,
  label,
  folded,
  onFold,
  action,
  children,
}: {
  id: SectionId;
  label: string;
  folded: boolean;
  onFold: (id: SectionId) => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className={folded ? "is-folded" : ""}>
      <div className="section-heading">
        <button
          className="section-toggle"
          aria-expanded={!folded}
          onClick={() => onFold(id)}
          title={folded ? `Show ${label}` : `Hide ${label}`}
        >
          {label}
          <ChevronRight size={12} className={folded ? "" : "rotated"} />
        </button>
        {action}
      </div>
      {!folded && children}
    </section>
  );
}

export function Sidebar(p: Props) {
  const [folded, setFolded] = useState<Set<SectionId>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) || "[]");
      // Read after mount so server and client render the same first frame.
      if (Array.isArray(saved) && saved.length)
        queueMicrotask(() => setFolded(new Set(saved)));
    } catch {}
  }, []);
  /**
   * Reveal the open page in the tree: once its row exists (parents may be expanding
   * this render), scroll it into view, but only if it's out of view, so the sidebar
   * never jumps under the mouse.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const revealPending = useRef<string | null>(null);
  const fold = (id: SectionId) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor),
  );
  /** The page being dragged, and where it would land. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: DropZone } | null>(null);
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const workspace = p.state.workspaces.find(
    (w) => w.id === p.state.active_workspace_id,
  );
  const recordPages = new Set(p.state.records.map((r) => r.page_id));
  const live = p.state.pages.filter(
    (x) => x.workspace_id === workspace?.id && !x.deleted_at,
  );
  const pages = live.filter((x) => !recordPages.has(x.id));
  const byId = new Map(live.map((x) => [x.id, x]));
  const recordCounts = new Map<string, number>();
  for (const r of p.state.records)
    if (byId.has(r.page_id))
      recordCounts.set(r.database_id, (recordCounts.get(r.database_id) || 0) + 1);
  // A database record isn't in the tree; its database stands in for it there.
  const openRecord = p.state.records.find((r) => r.page_id === p.activeId);
  const treeActiveId = openRecord
    ? (pages.find((x) => x.database_id === openRecord.database_id)?.id ?? p.activeId)
    : p.activeId;
  // Recents is "where you were": the open page is left out (it would always top the list).
  const recents = p.recentIds
    .filter((id) => id !== p.activeId)
    .map((id) => byId.get(id))
    .filter((x): x is Page => Boolean(x))
    .slice(0, 5);
  const home = pages
    .filter((x) => x.parent_id === null)
    .sort((a, b) => a.position - b.position)[0];
  const sorted = (parent: string | null) =>
    pages
      .filter((x) => x.parent_id === parent)
      .sort((a, b) => a.position - b.position);
  const visible: Page[] = [];
  const render = (parent: string | null, depth = 0): React.ReactNode =>
    sorted(parent).map((page) => {
      visible.push(page);
      return (
        <div key={page.id}>
          <TreeRow
            page={page}
            depth={depth}
            hasChildren={pages.some((x) => x.parent_id === page.id)}
            expanded={p.expanded.has(page.id)}
            active={treeActiveId === page.id}
            onOpen={() => p.onOpen(page.id)}
            onExpand={() => p.onExpand(page.id)}
            onNew={() => p.onNew(page.id)}
            onPageAction={p.onPageAction}
            recordCount={
              page.kind === "database" && page.database_id
                ? recordCounts.get(page.database_id) || 0
                : undefined
            }
            drop={
              drop?.id === page.id
                ? drop.zone === "after" && p.expanded.has(page.id) && pages.some((x) => x.parent_id === page.id && x.id !== dragId)
                  ? "inside-first"
                  : drop.zone
                : undefined
            }
          />
          {p.expanded.has(page.id) && render(page.id, depth + 1)}
        </div>
      );
    });
  const tree = render(null);
  useEffect(() => {
    revealPending.current = treeActiveId;
  }, [treeActiveId]);
  useEffect(() => {
    const id = revealPending.current;
    const scroller = scrollRef.current;
    if (!id || !scroller || p.collapsed) return;
    const row = scroller.querySelector<HTMLElement>(`[data-page-row="${window.CSS.escape(id)}"]`);
    if (!row) return; // Not rendered yet: an ancestor is still expanding.
    revealPending.current = null;
    const box = row.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.top < view.top || box.bottom > view.bottom)
      row.scrollIntoView({ block: "center" });
  });
  // Rows under the pointer win; the keyboard (no pointer) falls back to the nearest row.
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length ? hits : closestCenter(args);
  };
  const clearExpandTimer = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  /** Top quarter = above, bottom quarter = below, middle = inside (if it can hold pages). */
  const trackDrop = (e: DragMoveEvent) => {
    const overId = e.over ? String(e.over.id) : null;
    const activeId = String(e.active.id);
    if (!overId || !e.over || overId === activeId) {
      setDrop(null);
      clearExpandTimer();
      return;
    }
    const rect = e.over.rect;
    const pointer = e.activatorEvent as PointerEvent;
    const translated = e.active.rect.current.translated;
    const y =
      "clientY" in pointer && typeof pointer.clientY === "number"
        ? pointer.clientY + e.delta.y
        : translated
          ? translated.top + translated.height / 2
          : rect.top + rect.height / 2;
    const at = (y - rect.top) / rect.height;
    const canNest = !!dropPlacement(pages, activeId, overId, "inside");
    const zone: DropZone = at < 0.28 ? "before" : at > 0.72 ? "after" : canNest ? "inside" : at < 0.5 ? "before" : "after";
    if (!dropPlacement(pages, activeId, overId, zone, p.expanded)) {
      // e.g. hovering its own subpage: no valid place here.
      setDrop(null);
      clearExpandTimer();
      return;
    }
    setDrop((current) => (current?.id === overId && current.zone === zone ? current : { id: overId, zone }));
    // Hovering inside a collapsed page with subpages opens it after a moment.
    const collapsedParent = zone === "inside" && !p.expanded.has(overId) && pages.some((x) => x.parent_id === overId);
    if (!collapsedParent) return clearExpandTimer();
    if (expandTimer.current?.id === overId) return;
    clearExpandTimer();
    expandTimer.current = {
      id: overId,
      timer: setTimeout(() => {
        if (!p.expanded.has(overId)) p.onExpand(overId);
        expandTimer.current = null;
      }, 650),
    };
  };
  const finishDrag = () => {
    const current = drop;
    const moving = dragId;
    setDragId(null);
    setDrop(null);
    clearExpandTimer();
    if (!current || !moving) return;
    const placement = dropPlacement(pages, moving, current.id, current.zone, p.expanded);
    if (placement) p.onMovePage(moving, placement.parentId, placement.index);
  };
  const cancelDrag = () => {
    setDragId(null);
    setDrop(null);
    clearExpandTimer();
  };
  const dragged = dragId ? pages.find((x) => x.id === dragId) : undefined;
  const initial = workspace?.name.trim().charAt(0).toUpperCase() || "S";
  return (
    <aside
      className={`sidebar ${p.collapsed ? "is-collapsed" : ""}`}
      style={{ width: p.collapsed ? 0 : SIDEBAR_WIDTH }}
      aria-label="Workspace navigation"
      aria-hidden={p.collapsed}
      inert={p.collapsed}
    >
      <div className="sidebar-inner" style={{ width: SIDEBAR_WIDTH }}>
        <div className="sidebar-top">
          <Link href="/" className="sidebar-brand" title="Slate home" aria-label="Slate home">
            <Brand size={22} />
          </Link>
          <span className="sidebar-top-actions">
            <button
              className="sidebar-icon"
              title="New page"
              aria-label="Create a page"
              onClick={() => p.onNew(null)}
            >
              <SquarePen size={17} />
            </button>
            <button
              className="sidebar-icon"
              title="Close sidebar (⌘ \)"
              aria-label="Collapse sidebar"
              onClick={p.onToggle}
            >
              <PanelLeftClose size={17} />
            </button>
          </span>
        </div>
        <button className="sidebar-search" onClick={p.onSearch}>
          <Search size={16} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <nav className="sidebar-primary" aria-label="Quick actions">
          <button
            // Shortcuts get a subtle "you're here" mark; the tree row has the real highlight.
            className={`nav-row home-row ${home && p.activeId === home.id ? "is-current" : ""}`}
            aria-current={home && p.activeId === home.id ? "page" : undefined}
            onClick={() => p.onOpen(home?.id || "")}
          >
            <House size={18} />
            <span>Home</span>
          </button>
          <button className="nav-row" onClick={() => p.onNew(null)}>
            <SquarePen size={18} />
            <span>New page</span>
          </button>
        </nav>
        <div className="sidebar-scroll" ref={scrollRef}>
          {pages.some((x) => x.favorite) && (
            <SidebarSection
              id="favorites"
              label="Favorites"
              folded={folded.has("favorites")}
              onFold={fold}
            >
              {pages
                .filter((x) => x.favorite)
                .map((page) => (
                  <button
                    className={`nav-row page-row ${page.id === p.activeId ? "is-current" : ""}`}
                    key={page.id}
                    aria-label={`${page.title || "Untitled"}, favorite`}
                    onClick={() => p.onOpen(page.id)}
                  >
                    <PageGlyph page={page} />
                    <span className={page.title ? "" : "is-untitled"}>{page.title || "Untitled"}</span>
                  </button>
                ))}
            </SidebarSection>
          )}
          {recents.length > 0 && (
            <SidebarSection
              id="recents"
              label="Recents"
              folded={folded.has("recents")}
              onFold={fold}
            >
              {recents.map((page) => (
                <button
                  className="nav-row page-row"
                  key={page.id}
                  // Distinct from the same page's tree row for assistive tech.
                  aria-label={`${page.title || "Untitled"}, recent`}
                  title={page.title || "Untitled"}
                  onClick={() => p.onOpen(page.id)}
                >
                  <PageGlyph page={page} />
                  <span className={page.title ? "" : "is-untitled"}>{page.title || "Untitled"}</span>
                </button>
              ))}
            </SidebarSection>
          )}
          <SidebarSection
            id="private"
            label="Private"
            folded={folded.has("private")}
            onFold={fold}
            action={
              <button
                className="icon-button"
                aria-label="Add a private page"
                title="Add a page"
                onClick={() => p.onNew(null)}
              >
                <Plus size={14} />
              </button>
            }
          >
            <DndContext
              id="slate-sidebar"
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={(e) => setDragId(String(e.active.id))}
              onDragMove={trackDrop}
              onDragOver={trackDrop}
              onDragEnd={finishDrag}
              onDragCancel={cancelDrag}
            >
              {tree}
              {/* What's being dragged follows the pointer as a small chip. */}
              <DragOverlay dropAnimation={null} modifiers={[besidePointer]}>
                {dragged ? (
                  <div className="tree-drag-preview">
                    <PageGlyph page={dragged} />
                    <span>{dragged.title || "Untitled"}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
            {!pages.length && (
              <p className="sidebar-empty">No pages yet.</p>
            )}
          </SidebarSection>
        </div>
        {p.isDemo && p.onDismissDemoCard && (
          <div className="sidebar-card" role="note">
            <HardDrive size={16} />
            <div>
              <strong>Local demo</strong>
              <p>Changes are saved in this browser only.</p>
            </div>
            <button
              className="sidebar-card-close"
              aria-label="Dismiss demo notice"
              onClick={p.onDismissDemoCard}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <nav className="sidebar-footer-nav" aria-label="More">
          <button className="nav-row" onClick={p.onTrash}>
            <Trash2 size={18} />
            <span>Trash</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <Menu
            side="top"
            trigger={
              <button
                className="workspace-switch"
                aria-label={`Workspace: ${workspace?.name || "Your workspace"}`}
              >
                <span className="workspace-avatar">{initial}</span>
                <span>{workspace?.name || "Your workspace"}</span>
                <ChevronDown size={16} />
              </button>
            }
          >
            <div className="menu-label">Your private workspaces</div>
            {p.state.workspaces.map((w) => (
              <MenuItem key={w.id} onClick={() => p.onWorkspace(w.id)}>
                <span className="workspace-avatar small">
                  {w.name.trim().charAt(0).toUpperCase()}
                </span>
                {w.name}
                {w.id === workspace?.id && (
                  <Check size={14} className="ml-auto" />
                )}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onClick={p.onCreateWorkspace}>
              <Plus />
              Create workspace
            </MenuItem>
            <MenuItem onClick={p.onSettings}>
              <Settings />
              Workspace settings
            </MenuItem>
          </Menu>
          <ShortcutsPopover
            trigger={
              <button
                className="sidebar-icon"
                aria-label="Help and keyboard shortcuts"
                title="Help"
              >
                <CircleHelp size={18} />
              </button>
            }
          />
          <button
            className="sidebar-icon"
            aria-label="Settings"
            title="Settings"
            onClick={p.onSettings}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
