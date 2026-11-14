"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Modal } from "./ui/menu";
import { PageIcon } from "./page-icon";
import type { Page, WorkspaceState } from "@/lib/types";
import { breadcrumbs } from "@/lib/tree";
import { timeAgo } from "@/lib/utils";

function Highlight({ value, query }: { value: string; query: string }) {
  if (!query) return <>{value}</>;
  const at = value.toLowerCase().indexOf(query.toLowerCase());
  return at < 0 ? (
    <>{value}</>
  ) : (
    <>
      {value.slice(0, at)}
      <mark>{value.slice(at, at + query.length)}</mark>
      {value.slice(at + query.length)}
    </>
  );
}

/** Readable text around the first match, without Markdown and directive syntax. */
function snippet(markdown: string, query: string): string {
  const line = markdown
    .split("\n")
    .find(
      (entry) =>
        !entry.startsWith(":::") && entry.toLowerCase().includes(query),
    );
  if (!line) return "";
  const text = line
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>|- \[[ x]\])\s+/i, "")
    .replace(/[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return text.slice(0, 90);
  const start = Math.max(0, at - 36);
  return `${start ? "…" : ""}${text.slice(start, at + query.length + 54)}${at + query.length + 54 < text.length ? "…" : ""}`;
}

interface Result {
  page: Page;
  excerpt: string;
}

export function SearchDialog({
  open,
  onClose,
  state,
  onOpen,
  recentIds = [],
  currentId,
}: {
  open: boolean;
  onClose: () => void;
  state: WorkspaceState;
  onOpen: (id: string) => void;
  /** Recently visited page ids, newest first, and the page that's open now. */
  recentIds?: string[];
  currentId?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const results = useMemo<Result[]>(() => {
    const documents = new Map(
      state.documents.map((document) => [document.page_id, document.markdown]),
    );
    const pages = state.pages.filter(
      (p) => !p.deleted_at && p.workspace_id === state.active_workspace_id,
    );
    if (!needle) {
      // A quick switcher: the pages you were just on come first (the last one is
      // highlighted, so ⌘K then Enter takes you back), then recently edited pages.
      const byId = new Map(pages.map((page) => [page.id, page]));
      const visited = recentIds
        .filter((pageId) => pageId !== currentId)
        .map((pageId) => byId.get(pageId))
        .filter((page): page is (typeof pages)[number] => Boolean(page));
      const seen = new Set([currentId, ...visited.map((page) => page.id)]);
      const edited = [...pages]
        .filter((page) => !seen.has(page.id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return [...visited, ...edited].slice(0, 12).map((page) => ({ page, excerpt: "" }));
    }
    const ranked: (Result & { rank: number })[] = [];
    for (const page of pages) {
      const title = (page.title || "Untitled").toLowerCase();
      const text = `${page.description}\n${documents.get(page.id) || ""}`;
      const rank = title.startsWith(needle)
        ? 0
        : title.includes(needle)
          ? 1
          : text.toLowerCase().includes(needle)
            ? 2
            : -1;
      if (rank < 0) continue;
      ranked.push({
        page,
        rank,
        excerpt: rank === 2 ? snippet(text, needle) : "",
      });
    }
    return ranked
      .sort(
        (a, b) =>
          a.rank - b.rank || b.page.updated_at.localeCompare(a.page.updated_at),
      )
      .slice(0, 25);
  }, [state, needle, recentIds, currentId]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".search-result.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const visit = (id: string) => {
    onOpen(id);
    onClose();
  };
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Search your workspace"
      className="search-dialog"
    >
      <div className="search-input-wrap">
        <Search size={20} />
        <input
          placeholder="Search pages, databases, and more…"
          aria-label="Search workspace"
          role="combobox"
          aria-expanded
          aria-controls="search-results"
          aria-activedescendant={
            results[selected] ? `search-${results[selected].page.id}` : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((n) => Math.min(n + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((n) => Math.max(0, n - 1));
            }
            if (e.key === "Enter" && results[selected])
              visit(results[selected].page.id);
          }}
          autoFocus
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="search-results"
        id="search-results"
        role="listbox"
        aria-label="Search results"
        ref={listRef}
      >
        <div className="menu-label">
          {needle
            ? `${results.length} ${results.length === 1 ? "result" : "results"}`
            : "Recent pages"}
        </div>
        {!results.length && (
          <div className="empty-state">
            No pages found for “{query.trim()}”.
            <p>Try a different word, or check the Trash.</p>
          </div>
        )}
        {results.map(({ page: p, excerpt }, i) => (
          <button
            key={p.id}
            id={`search-${p.id}`}
            role="option"
            aria-selected={selected === i}
            className={`search-result ${selected === i ? "active" : ""}`}
            onMouseMove={() => setSelected(i)}
            onClick={() => visit(p.id)}
          >
            <PageIcon page={p} size={20} />
            <span>
              <strong className={p.title ? "" : "is-untitled"}>
                <Highlight value={p.title || "Untitled"} query={query.trim()} />
              </strong>
              {excerpt ? (
                <small className="search-excerpt">
                  <Highlight value={excerpt} query={query.trim()} />
                </small>
              ) : (
                <small>
                  {p.kind === "database" && (
                    <span className="search-kind">Database · </span>
                  )}
                  {breadcrumbs(state.pages, p.id)
                    .slice(0, -1)
                    .map((ancestor) => ancestor.title || "Untitled")
                    .join(" / ") ||
                    state.workspaces.find((w) => w.id === p.workspace_id)?.name}
                </small>
              )}
            </span>
            <span className="search-meta">
              {selected === i ? (
                <CornerDownLeft size={16} />
              ) : (
                timeAgo(p.updated_at)
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="search-footer">
        <span>
          <ArrowUp size={12} />
          <ArrowDown size={12} /> to navigate
        </span>
        <span>
          <CornerDownLeft size={12} /> to open
        </span>
        <span>Only your private workspace is searched</span>
      </div>
    </Modal>
  );
}
