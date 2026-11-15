"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { PageIcon } from "../page-icon";
import type { Page } from "../../lib/types";

export interface DatabaseChoice {
  id: string;
  name: string;
  page: Pick<Page, "icon" | "kind">;
  /** Where the database lives, e.g. "Projects / Planning". */
  path: string;
  records: number;
}

interface DatabasePickerProps {
  databases: DatabaseChoice[];
  onPick: (databaseId: string) => void;
  onCreate: () => void;
  onClose: () => void;
  position?: { top?: number; bottom?: number; left: number; maxHeight?: number };
}

/**
 * Picks a database to show in the page: an existing one (as a linked view) or a new
 * one. Search filters as you type; ↑↓ move, Enter picks, Esc closes.
 */
export function DatabasePicker({ databases, onPick, onCreate, onClose, position }: DatabasePickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  // Best matches first: names starting with the search, then names containing it,
  // then databases that only match by where they live.
  const rank = (db: DatabaseChoice) => {
    const name = (db.name || "Untitled database").toLowerCase();
    if (!q || name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return db.path.toLowerCase().includes(q) ? 2 : -1;
  };
  const matches = databases
    .map((db) => ({ db, rank: rank(db) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map(({ db }) => db);
  // Option 0 is always "New database"; the matches follow.
  const count = matches.length + 1;
  const index = Math.min(active, count - 1);
  const choose = (at: number) => {
    if (at === 0) onCreate();
    else if (matches[at - 1]) onPick(matches[at - 1].id);
  };
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);
  const option = (at: number) => ({
    id: `database-option-${at}`,
    "data-index": at,
    role: "option" as const,
    "aria-selected": at === index,
    className: at === index ? "is-selected" : "",
    tabIndex: -1,
    onMouseMove: () => at !== index && setActive(at),
    onMouseDown: (event: React.MouseEvent) => {
      event.preventDefault();
      choose(at);
    },
  });
  return (
    <>
      <button className="editor-menu-scrim" aria-label="Close database picker" onClick={onClose} />
      <div className="editor-db-picker" style={position} role="dialog" aria-label="Add a database">
        <label className="editor-db-picker-search">
          <Search size={15} />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="database-options"
            aria-activedescendant={`database-option-${index}`}
            aria-label="Search databases"
            placeholder="Search databases…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(matches.length && event.target.value.trim() ? 1 : 0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive((index + step + count) % count);
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(index);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </label>
        <div
          className="editor-db-picker-list"
          id="database-options"
          role="listbox"
          aria-label="Databases"
          ref={listRef}
        >
          <button {...option(0)}>
            <span className="editor-db-picker-icon is-new">
              <Plus size={16} />
            </span>
            <span>
              <strong>New database</strong>
              <small>Create an empty database here</small>
            </span>
          </button>
          <div className="editor-menu-label">{databases.length ? "Link an existing database" : "No databases yet"}</div>
          {matches.map((db, at) => (
            <button key={db.id} {...option(at + 1)}>
              <span className="editor-db-picker-icon">
                <PageIcon page={db.page} size={16} />
              </span>
              <span>
                <strong>{db.name || "Untitled database"}</strong>
                <small>{db.path || "Top level"}</small>
              </span>
              <em>{db.records}</em>
            </button>
          ))}
          {databases.length > 0 && !matches.length && (
            <div className="editor-no-results">No databases match “{query.trim()}”.</div>
          )}
        </div>
        <div className="slash-menu-footer">
          <span>↑↓ to choose</span>
          <span>↵ to add · esc to close</span>
        </div>
      </div>
    </>
  );
}
