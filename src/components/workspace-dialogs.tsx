"use client";
import { Button } from "./ui/button";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CornerDownLeft,
  Check,
  Folder,
  Lock,
  LogOut,
  Maximize2,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "./ui/menu";
import { PageIcon } from "./page-icon";
import { IconPicker } from "./icon-picker";
import { ThemeSwitcher } from "./theme-switcher";
import { AgentKeysSection } from "./agent-keys-section";
import { RecordProperties } from "./database/DatabaseView";
import { breadcrumbs, canMovePage, purgePage, trashPage } from "@/lib/tree";
import { id, timeAgo } from "@/lib/utils";
import type { DbRecord, Page, WorkspaceState } from "@/lib/types";
import { LICENSE_NAME, REPOSITORY_URL } from "@/lib/project";

type ChangeState = (update: (state: WorkspaceState) => WorkspaceState) => void;
type DialogState =
  | { type: "rename"; page: Page }
  | { type: "move"; page: Page }
  | { type: "icon"; page: Page }
  | { type: "trash" }
  | { type: "new-workspace" }
  | { type: "settings" }
  | null;

export interface WorkspaceDialogController {
  active: DialogState;
  close: () => void;
  renamePage: (page: Page) => void;
  movePage: (page: Page) => void;
  pageIcon: (page: Page) => void;
  trash: () => void;
  newWorkspace: () => void;
  settings: () => void;
}

/** One active workspace dialog at a time; each form owns its temporary input. */
export function useWorkspaceDialogs(): WorkspaceDialogController {
  const [active, setActive] = useState<DialogState>(null);
  return {
    active,
    close: useCallback(() => setActive(null), []),
    renamePage: useCallback(
      (page: Page) => setActive({ type: "rename", page }),
      [],
    ),
    movePage: useCallback(
      (page: Page) => setActive({ type: "move", page }),
      [],
    ),
    pageIcon: useCallback(
      (page: Page) => setActive({ type: "icon", page }),
      [],
    ),
    trash: useCallback(() => setActive({ type: "trash" }), []),
    newWorkspace: useCallback(() => setActive({ type: "new-workspace" }), []),
    settings: useCallback(() => setActive({ type: "settings" }), []),
  };
}

interface CommonProps {
  state: WorkspaceState;
  close: () => void;
}
interface PageMutationProps {
  patchPage: (pageId: string, patch: Partial<Page>) => void;
}
interface WorkspaceDialogsProps extends PageMutationProps {
  controller: WorkspaceDialogController;
  state: WorkspaceState;
  change: ChangeState;
  expandPage: (pageId: string) => void;
  onWorkspaceCreated: () => void;
  record?: DbRecord;
  recordPage?: Page;
  recordParent?: Page;
  openRecord: (record: DbRecord) => void;
  /** Opens a page in the main view (the record's database, from the panel header). */
  openPage: (pageId: string) => void;
  closeRecord: () => void;
  /** Leaves the side peek and shows the record as a full page. */
  expandRecord: () => void;
  /** False while the record is shown as a full page instead of a peek. */
  peekOpen: boolean;
  renderEditor: (page: Page) => ReactNode;
}

export function WorkspaceDialogs(props: WorkspaceDialogsProps) {
  const {
    controller,
    state,
    change,
    patchPage,
    expandPage,
    onWorkspaceCreated,
  } = props;
  const { active, close } = controller;
  return (
    <>
      {active?.type === "rename" && (
        <RenamePageDialog
          close={close}
          page={active.page}
          patchPage={patchPage}
        />
      )}
      {active?.type === "move" && (
        <MovePageDialog
          state={state}
          close={close}
          page={active.page}
          patchPage={patchPage}
          expandPage={expandPage}
        />
      )}
      {active?.type === "icon" && (
        <PageIconDialog
          close={close}
          page={active.page}
          patchPage={patchPage}
        />
      )}
      {active?.type === "trash" && (
        <TrashDialog state={state} close={close} change={change} />
      )}
      {active?.type === "new-workspace" && (
        <NewWorkspaceDialog
          close={close}
          change={change}
          onCreated={onWorkspaceCreated}
        />
      )}
      {active?.type === "settings" && (
        <SettingsDialog
          state={state}
          close={close}
          change={change}
        />
      )}
      <RecordPageDialog
        record={props.record}
        page={props.recordPage}
        parent={props.recordParent}
        state={state}
        change={change}
        patchPage={patchPage}
        close={props.closeRecord}
        expand={props.expandRecord}
        open={props.peekOpen}
        openRecord={props.openRecord}
        openPage={props.openPage}
        renderEditor={props.renderEditor}
      />
    </>
  );
}

function RenamePageDialog({
  page,
  patchPage,
  close,
}: PageMutationProps & { page: Page; close: () => void }) {
  const [name, setName] = useState(page.title);
  const unchanged = name.trim() === page.title;
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Rename page"
      className="compact-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!unchanged) patchPage(page.id, { title: name.trim() || "Untitled" });
          close();
        }}
      >
        <label className="rename-field">
          <PageIcon page={page} size={18} />
          <input
            autoFocus
            aria-label="Page name"
            placeholder="Untitled"
            value={name}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="modal-footer">
          <span className="modal-hint">
            <kbd>↵</kbd> to save · <kbd>esc</kbd> to cancel
          </span>
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <Button disabled={unchanged}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function MovePageDialog({
  state,
  close,
  page,
  patchPage,
  expandPage,
}: CommonProps &
  PageMutationProps & { page: Page; expandPage: (pageId: string) => void }) {
  const [query, setQuery] = useState("");
  const recordPages = new Set(state.records.map((record) => record.page_id));
  const targets = state.pages
    .filter(
      (target) =>
        target.workspace_id === state.active_workspace_id &&
        !target.deleted_at &&
        target.kind === "document" &&
        !recordPages.has(target.id) &&
        canMovePage(state.pages, page.id, target.id),
    )
    .map((target) => ({
      page: target,
      path: breadcrumbs(state.pages, target.id)
        .map((ancestor) => ancestor.title || "Untitled")
        .join(" / "),
    }))
    .filter(({ path }) => path.toLowerCase().includes(query.trim().toLowerCase()));
  const moveTo = (parentId: string | null) => {
    if (parentId === page.parent_id) return close();
    // Land after the new siblings rather than at an arbitrary position.
    const last = Math.max(
      -1,
      ...state.pages
        .filter((sibling) => sibling.parent_id === parentId && !sibling.deleted_at)
        .map((sibling) => sibling.position),
    );
    patchPage(page.id, { parent_id: parentId, position: last + 1 });
    if (parentId) expandPage(parentId);
    close();
    const destination = state.pages.find((target) => target.id === parentId);
    toast(`Moved to ${destination?.title || "Private pages"}`);
  };
  const current = (parentId: string | null) =>
    parentId === page.parent_id ? (
      <span className="move-current">
        <Check size={14} /> Current
      </span>
    ) : null;
  // One list for the keyboard: "Private pages" first (when not searching), then pages.
  const options: (string | null)[] = [
    ...(query.trim() ? [] : [null]),
    ...targets.map(({ page: target }) => target.id),
  ];
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);
  const option = (index: number) => ({
    "data-index": index,
    className: index === activeIndex ? "active" : undefined,
    onMouseMove: () => setActive(index),
  });
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title={`Move “${page.title || "Untitled"}”`}
      description="Choose a new home for this page and its children."
      className="list-dialog"
    >
      <label className="move-search">
        <Search size={16} />
        <input
          autoFocus
          aria-label="Find a destination"
          placeholder="Find a page…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((activeIndex + step + options.length) % Math.max(1, options.length));
            } else if (event.key === "Enter" && options.length) {
              event.preventDefault();
              moveTo(options[activeIndex]);
            }
          }}
        />
      </label>
      <div className="move-targets" ref={listRef}>
        {!query.trim() && (
          <button {...option(0)} onClick={() => moveTo(null)}>
            <Folder size={16} />
            <span className="move-title">
              <strong>Private pages</strong>
              <small>Top level of the sidebar</small>
            </span>
            {current(null)}
          </button>
        )}
        {targets.map(({ page: target, path }, index) => {
          const parentPath = path.split(" / ").slice(0, -1).join(" / ");
          return (
            <button
              key={target.id}
              {...option(index + (query.trim() ? 0 : 1))}
              onClick={() => moveTo(target.id)}
            >
              <PageIcon page={target} size={16} />
              <span className="move-title">
                <strong>{target.title || "Untitled"}</strong>
                {parentPath && <small>{parentPath}</small>}
              </span>
              {current(target.id)}
            </button>
          );
        })}
        {query.trim() && !targets.length && (
          <div className="empty-state">No pages match “{query.trim()}”.</div>
        )}
      </div>
      <div className="modal-hint list-hint">
        <kbd>↑</kbd> <kbd>↓</kbd> to choose · <CornerDownLeft size={12} /> to move
      </div>
    </Modal>
  );
}

function PageIconDialog({
  close,
  page,
  patchPage,
}: PageMutationProps & { close: () => void; page: Page }) {
  // The page prop is a snapshot from when the dialog opened; track edits locally.
  const [icon, setIcon] = useState(page.icon);
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title={`Icon for “${page.title || "Untitled"}”`}
      className="icon-dialog"
    >
      <IconPicker
        value={icon}
        onChange={(next) => {
          setIcon(next);
          patchPage(page.id, { icon: next });
        }}
        onClose={close}
      />
    </Modal>
  );
}

function TrashDialog({
  state,
  close,
  change,
}: CommonProps & { change: ChangeState }) {
  const deletedPages = state.pages.filter(
    (page) =>
      page.deleted_at && page.workspace_id === state.active_workspace_id,
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const roots = deletedPages
    .filter(
      (page) =>
        !state.pages.find((parent) => parent.id === page.parent_id)?.deleted_at,
    )
    .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)))
    .filter((page) =>
      (page.title || "Untitled").toLowerCase().includes(query.trim().toLowerCase()),
    );
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Trash"
      description="Deleted pages stay here until you restore them or delete them forever."
      className="list-dialog"
    >
      {deletedPages.length > 0 && (
        <label className="move-search">
          <Search size={16} />
          <input
            autoFocus
            aria-label="Search the trash"
            placeholder="Search deleted pages…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <div className="trash-list">
        {deletedPages.length > 0 && !roots.length && (
          <div className="empty-state">No deleted pages match “{query.trim()}”.</div>
        )}
        {!deletedPages.length && (
          <div className="empty-state">
            <Trash2 size={26} />
            <p>Nothing in the trash. A clean slate.</p>
          </div>
        )}
        {roots.map((page) => {
          const parent = state.pages.find((item) => item.id === page.parent_id);
          return (
            <div key={page.id} className="trash-item">
              <PageIcon page={page} size={18} />
              <span className="trash-title">
                <strong>{page.title || "Untitled"}</strong>
                <small>
                  Deleted {timeAgo(page.deleted_at)}
                  {parent ? ` · from ${parent.title || "Untitled"}` : ""}
                </small>
              </span>
              {confirming === page.id ? (
                <span className="trash-confirm">
                  <button
                    className="secondary-button"
                    onClick={() => setConfirming(null)}
                  >
                    Keep
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      change((current) => purgePage(current, page.id));
                      setConfirming(null);
                      toast(`“${page.title || "Untitled"}” deleted forever`);
                    }}
                  >
                    Delete forever
                  </button>
                </span>
              ) : (
                <span className="trash-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      change((current) => trashPage(current, page.id, true));
                      toast.success("Page restored");
                    }}
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${page.title || "Untitled"} forever`}
                    title="Delete forever"
                    onClick={() => setConfirming(page.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function NewWorkspaceDialog({
  close,
  change,
  onCreated,
}: {
  close: () => void;
  change: ChangeState;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Create a workspace"
      description="Keep your projects and ideas in their own private workspace."
      className="compact-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const workspaceId = id();
          change((state) => ({
            ...state,
            workspaces: [
              ...state.workspaces,
              { id: workspaceId, name: name.trim() || "My workspace" },
            ],
            active_workspace_id: workspaceId,
          }));
          close();
          onCreated();
          toast.success("Workspace created");
        }}
      >
        <label className="field-label">
          Workspace name
          <input
            autoFocus
            placeholder="My workspace"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <Button>Create workspace</Button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsDialog({
  state,
  close,
  change,
}: CommonProps & { change: ChangeState }) {
  const router = useRouter();
  const currentWorkspace = state.workspaces.find(
    (workspace) => workspace.id === state.active_workspace_id,
  );
  const [name, setName] = useState(currentWorkspace?.name || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteWorkspace = () => {
    const workspaceId = state.active_workspace_id;
    const keep = state.workspaces.find(
      (workspace) => workspace.id !== workspaceId,
    );
    if (!keep) return;
    change((current) => {
      const pageIds = new Set(
        current.pages
          .filter((page) => page.workspace_id === workspaceId)
          .map((page) => page.id),
      );
      const databaseIds = new Set(
        current.databases
          .filter((database) => database.workspace_id === workspaceId)
          .map((database) => database.id),
      );
      return {
        ...current,
        active_workspace_id: keep.id,
        workspaces: current.workspaces.filter(
          (workspace) => workspace.id !== workspaceId,
        ),
        pages: current.pages.filter((page) => !pageIds.has(page.id)),
        documents: current.documents.filter(
          (document) => !pageIds.has(document.page_id),
        ),
        databases: current.databases.filter(
          (database) => !databaseIds.has(database.id),
        ),
        properties: current.properties.filter(
          (property) => !databaseIds.has(property.database_id),
        ),
        records: current.records.filter(
          (record) => !databaseIds.has(record.database_id),
        ),
        views: current.views.filter(
          (view) => !databaseIds.has(view.database_id),
        ),
      };
    });
    close();
    toast("Workspace deleted");
  };
  const logOut = async () => {
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    router.push("/auth/login");
    router.refresh();
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Settings"
      description="A workspace that feels like yours."
      className="settings-dialog"
    >
      <div className="settings-content">
        <section className="settings-section">
          <h3>Workspace</h3>
          <form
            className="settings-name"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || name.trim() === currentWorkspace?.name) return;
              change((current) => ({
                ...current,
                workspaces: current.workspaces.map((workspace) =>
                  workspace.id === current.active_workspace_id
                    ? { ...workspace, name: name.trim() }
                    : workspace,
                ),
              }));
              toast.success("Workspace renamed");
            }}
          >
            <label className="field-label">
              Name
              <span className="settings-inline">
                <input
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button
                  disabled={!name.trim() || name.trim() === currentWorkspace?.name}
                >
                  Save
                </Button>
              </span>
            </label>
          </form>
          <div className="settings-note">
            <Lock size={16} />
            <div>
              <strong>Private by default</strong>
              <p>Everything in this workspace is visible only to you.</p>
            </div>
          </div>
        </section>
        <section className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-row">
            <div>
              <strong>Theme</strong>
              <p>Follow your system, or keep Slate light or dark.</p>
            </div>
            <ThemeSwitcher />
          </div>
        </section>
        <AgentKeysSection />
        <section className="settings-section">
          <h3>Account</h3>
          <>
              <div className="settings-row">
                <div>
                  <strong>Password</strong>
                  <p>Change the password you use to sign in.</p>
                </div>
                <a className="secondary-button" href="/auth/reset">
                  Change password
                  <ArrowUpRight size={14} />
                </a>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Log out</strong>
                  <p>Sign out of Slate on this device.</p>
                </div>
                <button className="secondary-button" onClick={() => void logOut()}>
                  <LogOut size={14} />
                  Log out
                </button>
              </div>
            </>
        </section>
        <section className="settings-section">
          <h3>About</h3>
          <div className="settings-row">
            <div>
              <strong>Slate is open source</strong>
              <p>Free software under the {LICENSE_NAME} license. Read the code, report issues or run your own copy.</p>
            </div>
            <a className="secondary-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              Source code
              <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
        <section className="settings-section danger-zone">
          <h3>Danger zone</h3>
          {!confirmDelete ? (
            <div className="settings-row">
              <div>
                <strong>Delete this workspace</strong>
                <p>Removes the workspace and every page in it.</p>
              </div>
              <button
                className="secondary-button danger-outline"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                Delete…
              </button>
            </div>
          ) : (
            <div className="danger-confirm">
              <strong>Delete “{currentWorkspace?.name}”?</strong>
              <p>
                This permanently removes the workspace and all of its pages. It
                can’t be undone.
              </p>
              {state.workspaces.length < 2 && (
                <small>Create another workspace before deleting your last one.</small>
              )}
              <div className="confirm-actions">
                <button
                  className="secondary-button"
                  autoFocus
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={state.workspaces.length < 2}
                  onClick={deleteWorkspace}
                >
                  Delete workspace
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

interface RecordPageDialogProps extends PageMutationProps {
  record?: DbRecord;
  page?: Page;
  parent?: Page;
  state: WorkspaceState;
  change: ChangeState;
  close: () => void;
  expand: () => void;
  open: boolean;
  openRecord: (record: DbRecord) => void;
  openPage: (pageId: string) => void;
  renderEditor: (page: Page) => ReactNode;
}
function RecordPageDialog({
  record,
  page,
  parent,
  state,
  change,
  patchPage,
  close,
  expand,
  open,
  openRecord,
  openPage,
  renderEditor,
}: RecordPageDialogProps) {
  return (
    <Modal
      open={!!record && open}
      onOpenChange={(value) => !value && close()}
      // The big title field names the record; the heading shows where it lives.
      title={parent?.title || "Database record"}
      className="record-dialog"
      variant="peek"
      // Where the record lives, with its icon, like a breadcrumb: click to open it.
      heading={
        parent ? (
          <button
            className="peek-parent"
            onClick={() => openPage(parent.id)}
            title={`Open ${parent.title || "Untitled"}`}
            aria-label={`Open ${parent.title || "Untitled"}`}
          >
            <PageIcon page={parent} size={14} />
            <span>{parent.title || "Untitled"}</span>
          </button>
        ) : undefined
      }
      actions={
        <button
          className="icon-button"
          aria-label="Open as full page"
          title="Open as full page"
          onClick={expand}
        >
          <Maximize2 size={16} />
        </button>
      }
    >
      {record && page && (
        <>
          <input
            className="record-title-input"
            aria-label="Record title"
            placeholder="Untitled"
            autoFocus
            value={page.title}
            onChange={(event) =>
              patchPage(page.id, { title: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget
                .closest(".record-dialog")
                ?.querySelector<HTMLElement>(".ProseMirror")
                ?.focus();
            }}
          />
          <RecordProperties
            record={record}
            state={state}
            onChange={change}
            onOpenRecord={openRecord}
          />
          {renderEditor(page)}
        </>
      )}
    </Modal>
  );
}
