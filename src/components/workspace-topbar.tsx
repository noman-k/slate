"use client";
/** The bar above a page: its breadcrumbs, whether it's saved, and the page's own menu. */
import {
  Check,
  Cloud,
  CloudOff,
  Copy,
  Download,
  Code2,
  Compass,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import type { Page, SaveStatus } from "@/lib/types";
import { PageActions, type PageAction } from "./sidebar";
import { PageIcon } from "./page-icon";
import { PLAYBOOKS_VIEW } from "./playbooks-view";
import { Menu, MenuItem, MenuSeparator, Popup } from "./ui/menu";
import { download } from "./workspace-helpers";
import { exportFileName } from "@/lib/export";

export function WorkspaceTopbar({
  collapsed,
  onShowSidebar,
  playbooks,
  chain,
  page,
  status,
  onOpen,
  onAction,
  exportMarkdown,
  canViewSource,
  onViewSource,
  loading = false,
}: {
  /** The sidebar is hidden, so the bar offers to show it. */
  collapsed: boolean;
  onShowSidebar: () => void;
  /** The Playbooks list is open (rather than a page). */
  playbooks: boolean;
  /** The open page and the pages above it, top first. */
  chain: Page[];
  page: Page | undefined;
  status: SaveStatus;
  onOpen: (pageId: string) => void;
  onAction: (action: PageAction, page: Page) => void;
  /** A page as one Markdown file, for Export Markdown (lib/export.ts). */
  exportMarkdown: (pageId: string) => string;
  /** A playbook's source can be viewed as Markdown. */
  canViewSource: boolean;
  onViewSource: (pageId: string) => void;
  /** The workspace is still loading. */
  loading?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {collapsed && (
          <button className="icon-button" onClick={onShowSidebar} aria-label="Show sidebar">
            <PanelLeft size={18} />
          </button>
        )}
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          {playbooks && (
            <span>
              <button onClick={() => onOpen(PLAYBOOKS_VIEW)}>
                <Compass size={16} />
                <span>Playbooks</span>
              </button>
            </span>
          )}
          {chain.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="breadcrumb-separator">/</span>}
              <button onClick={() => onOpen(p.id)} title={p.title}>
                <PageIcon page={p} size={16} fallback={null} />
                <span>{p.title || "Untitled"}</span>
              </button>
            </span>
          ))}
        </nav>
      </div>
      {/* Nothing to say (saved, private) until the workspace is there. */}
      <div className={`topbar-actions ${loading ? "is-loading" : ""}`} aria-hidden={loading || undefined}>
        <span
          className={`save-status ${status}`}
          title={status === "saved" ? "All changes saved" : "Saving your changes"}
        >
          {status === "saved" ? <Check size={12} /> : status === "error" ? <CloudOff size={14} /> : <Cloud size={14} />}
          <span>{status === "saved" ? "Saved" : status === "saving" ? "Saving…" : "Save failed"}</span>
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
            <p>This page belongs to your private workspace. Only you can access it.</p>
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
              aria-label={page.favorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => onAction("favorite", page)}
            >
              <Star size={18} fill={page.favorite ? "currentColor" : "none"} />
            </button>
            <Menu
              align="end"
              trigger={
                <button className="icon-button" aria-label="Page options">
                  <MoreHorizontal size={20} />
                </button>
              }
            >
              <PageActions page={page} onAction={onAction} />
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  const file = exportFileName(page.title);
                  download(file, exportMarkdown(page.id));
                  toast.success(`Exported ${file}`);
                }}
              >
                <Download />
                Export Markdown
              </MenuItem>
              {canViewSource && (
                <MenuItem onClick={() => onViewSource(page.id)}>
                  <Code2 />
                  View as Markdown
                </MenuItem>
              )}
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
  );
}
