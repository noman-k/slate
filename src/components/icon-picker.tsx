"use client";
import { isTouchOnly } from "./keys";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Search, Shuffle, X } from "lucide-react";
import {
  PAGE_ICON_COLORS,
  PAGE_ICON_GROUPS,
  PAGE_ICON_KEYWORDS,
  PAGE_ICON_SET,
  iconValue,
  parsePageIcon,
  type PageIconColor,
} from "./page-icon";

const RECENT_KEY = "slate-recent-icons";
const COLOR_KEY = "slate-icon-color";
const ALL_ICONS = PAGE_ICON_GROUPS.flatMap((group) => group.icons.map((icon) => icon.name));

const pretty = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, " ");

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === "string" && name in PAGE_ICON_SET)
      : [];
  } catch {
    return [];
  }
}
function readColor(): PageIconColor {
  try {
    const value = localStorage.getItem(COLOR_KEY);
    return (PAGE_ICON_COLORS as readonly string[]).includes(value || "") ? (value as PageIconColor) : "gray";
  } catch {
    return "gray";
  }
}
function remember(name: string, color: PageIconColor) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, 18)));
    localStorage.setItem(COLOR_KEY, color);
  } catch {
    /* Preferences are a convenience; picking still works without storage. */
  }
}

/** Moves focus between icon cells; up/down pick the nearest cell in the next row. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  const active = document.activeElement as HTMLElement | null;
  if (!keys.includes(event.key) || !active?.dataset.cell) return;
  const cells = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-cell]")];
  const index = cells.indexOf(active);
  let next: HTMLElement | undefined;
  if (event.key === "ArrowLeft") next = cells[index - 1];
  else if (event.key === "ArrowRight") next = cells[index + 1];
  else if (event.key === "Home") next = cells[0];
  else if (event.key === "End") next = cells[cells.length - 1];
  else {
    const from = active.getBoundingClientRect();
    const down = event.key === "ArrowDown";
    const row = cells
      .map((cell) => ({ cell, box: cell.getBoundingClientRect() }))
      .filter(({ box }) => (down ? box.top > from.top + 4 : box.top < from.top - 4));
    if (!row.length) {
      // Above the first row, return to the search field.
      if (!down) event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      event.preventDefault();
      return;
    }
    const top = down ? Math.min(...row.map(({ box }) => box.top)) : Math.max(...row.map(({ box }) => box.top));
    next = row
      .filter(({ box }) => Math.abs(box.top - top) < 4)
      .sort((a, b) => Math.abs(a.box.left - from.left) - Math.abs(b.box.left - from.left))[0]?.cell;
  }
  if (next) {
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  }
}

/**
 * Searchable, categorized icon picker. Calls `onChange` with "icon:<name>:<color>" or ""
 * (remove). Changing the color recolors the current icon right away.
 */
export function IconPicker({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (icon: string) => void;
  onClose: () => void;
}) {
  const current = parsePageIcon(value);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<PageIconColor>(() => (current.kind === "icon" ? current.color : readColor()));
  const [recent] = useState(readRecent);
  const [preview, setPreview] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A menu that opened the picker restores focus to its own trigger just after
    // closing; take focus back so typing goes straight into search.
    // On a phone that would raise the keyboard over the icons: tap search when needed.
    if (isTouchOnly()) return;
    const timer = setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) searchRef.current?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length
    ? ALL_ICONS.filter((name) => words.every((word) => PAGE_ICON_KEYWORDS[name].includes(word)))
    : null;
  const sections = results
    ? [{ label: results.length === 1 ? "1 icon" : `${results.length} icons`, names: results }]
    : [
        ...(recent.length ? [{ label: "Recent", names: recent.slice(0, 9) }] : []),
        ...PAGE_ICON_GROUPS.map((group) => ({ label: group.label, names: group.icons.map((icon) => icon.name) })),
      ];

  const choose = (name: string) => {
    remember(name, color);
    onChange(iconValue(name, color));
    onClose();
  };
  const recolor = (next: PageIconColor) => {
    setColor(next);
    if (current.kind === "icon") onChange(iconValue(current.name, next));
  };
  const shown = preview ?? (current.kind === "icon" ? current.name : null);
  const ShownIcon = shown ? PAGE_ICON_SET[shown] : null;

  return (
    <div className="icon-picker" ref={rootRef} onKeyDown={moveFocus}>
      <div className="icon-picker-top">
        <label className="icon-search">
          <Search size={16} />
          <input
            ref={searchRef}
            aria-label="Search icons"
            placeholder="Search icons…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPreview(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget.closest(".icon-picker")?.querySelector<HTMLElement>("[data-cell]")?.focus();
              }
              if (event.key === "Enter" && results?.[0]) {
                event.preventDefault();
                choose(results[0]);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="icon-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <button
          type="button"
          className="icon-tool"
          aria-label="Random icon"
          title="Random icon"
          onClick={() => choose(ALL_ICONS[Math.floor(Math.random() * ALL_ICONS.length)])}
        >
          <Shuffle size={16} />
        </button>
        {current.kind === "icon" && (
          <button
            type="button"
            className="icon-tool icon-remove"
            onClick={() => {
              onChange("");
              onClose();
            }}
          >
            Remove
          </button>
        )}
      </div>
      <div className="icon-colors" role="radiogroup" aria-label="Icon color">
        {PAGE_ICON_COLORS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={color === value}
            aria-label={pretty(value)}
            title={pretty(value)}
            className={`icon-swatch ${color === value ? "active" : ""}`}
            style={{ color: `var(--icon-${value})` }}
            onClick={() => recolor(value)}
          />
        ))}
      </div>
      <div className="icon-scroll" onMouseLeave={() => setPreview(null)}>
        {sections.map((section) => (
          <section key={section.label}>
            <div className="icon-section-label">{section.label}</div>
            <div className="icon-grid">
              {section.names.map((name) => {
                const Icon = PAGE_ICON_SET[name];
                const selected = current.kind === "icon" && current.name === name;
                return (
                  <button
                    key={`${section.label}-${name}`}
                    type="button"
                    data-cell
                    className={selected ? "active" : ""}
                    aria-label={`${pretty(name)} icon`}
                    aria-pressed={selected}
                    onMouseEnter={() => setPreview(name)}
                    onFocus={() => setPreview(name)}
                    onClick={() => choose(name)}
                  >
                    <Icon size={20} className={`page-icon page-icon-color-${color}`} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {results && !results.length && (
          <div className="icon-empty">
            <strong>No icons for “{query.trim()}”</strong>
            <span>Try a broader word, like “money”, “home” or “plan”.</span>
          </div>
        )}
      </div>
      <div className="icon-picker-footer">
        {ShownIcon && shown ? (
          <span className="icon-preview">
            <ShownIcon size={24} className={`page-icon page-icon-color-${color}`} />
            <span>
              <strong>{pretty(shown)}</strong>
              <small>
                {current.kind === "icon" && current.name === shown && !preview
                  ? "Current icon"
                  : "Click or press Enter to use"}
              </small>
            </span>
          </span>
        ) : (
          <span className="icon-preview icon-preview-empty">Pick a color, then an icon</span>
        )}
        <span className="icon-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move <kbd>↵</kbd> use
        </span>
      </div>
    </div>
  );
}

/** The picker in a popover anchored to `children` (the page icon or "Add icon"). */
export function IconPickerPopover({
  open,
  onOpenChange,
  value,
  onChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (icon: string) => void;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild ref={anchorRef}>
        {children}
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="icon-popover"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          sticky="always"
          aria-label="Choose a page icon"
          // Menus that open the picker hand focus back to their trigger as they close;
          // only an outside click or Escape should dismiss it.
          onFocusOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            // What opened it (the icon, or a menu's trigger), to hand focus back to.
            const active = document.activeElement as HTMLElement | null;
            opener.current = active && active !== document.body ? active : null;
            if (!isTouchOnly()) (event.currentTarget as HTMLElement)?.querySelector<HTMLElement>("input")?.focus();
          }}
          // It's anchored to the icon rather than opened by a trigger, so Radix has nothing
          // to return focus to: send it back to what opened it, or the icon itself.
          onCloseAutoFocus={(event) => {
            const target = opener.current?.isConnected
              ? opener.current
              : anchorRef.current?.querySelector<HTMLElement>(".document-icon, button");
            if (!target) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
        >
          <IconPicker value={value} onChange={onChange} onClose={() => onOpenChange(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
