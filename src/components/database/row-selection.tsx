"use client";
/**
 * Selecting table rows, as in Notion: a checkbox beside each row (shown on hover, and on
 * every row once something is selected), Shift-click for a range, and a header checkbox
 * for all of them. While rows are selected a bar takes the place of the view tabs with
 * what can be done to them; Delete or Backspace moves them to the Trash and Esc lets go.
 * On a touch screen, "Select" in a row's menu starts it, and then tapping a row selects it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Pin, PinOff, Trash2, X } from "lucide-react";

/** Whether an event is aimed at somewhere text is typed (where Backspace edits, not deletes). */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");

export function useRowSelection({
  ids,
  resetKey,
  root,
  onDelete,
}: {
  /** The rows shown, in order (selection never includes rows that aren't). */
  ids: string[];
  /** Selection starts over when this changes (another view, say). */
  resetKey: string;
  /** Clicking outside this lets go of the selection. */
  root: React.RefObject<HTMLElement | null>;
  onDelete: (ids: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setChosen(new Set());
  }
  // Only rows still shown count (a filter or a delete elsewhere may have hidden some).
  const selected = useMemo(() => ids.filter((id) => chosen.has(id)), [ids, chosen]);
  const count = selected.length;

  const clear = useCallback(() => {
    setChosen(new Set());
    anchor.current = null;
  }, []);
  /** Ticks or unticks a row; with Shift, everything from the last row clicked to this one. */
  const toggle = useCallback(
    (id: string, range = false) => {
      // Read the last row clicked now: the update below runs after it moves on to this one.
      const from = range && anchor.current ? ids.indexOf(anchor.current) : -1;
      const to = ids.indexOf(id);
      const last = anchor.current;
      anchor.current = id;
      setChosen((current) => {
        const next = new Set(current);
        if (from >= 0 && to >= 0) {
          const on = last ? current.has(last) : true;
          for (const rowId of ids.slice(Math.min(from, to), Math.max(from, to) + 1))
            if (on) next.add(rowId);
            else next.delete(rowId);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [ids],
  );
  const toggleAll = useCallback(() => {
    setChosen(count === ids.length ? new Set() : new Set(ids));
    anchor.current = null;
  }, [count, ids]);

  const remove = useCallback(() => {
    if (!selected.length) return;
    onDelete(selected);
    clear();
  }, [selected, onDelete, clear]);

  // Keys while rows are selected: Esc lets go, Delete or Backspace moves them to the Trash.
  useEffect(() => {
    if (!count) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event.target)) return;
      if (document.querySelector("[role='menu'], [role='dialog']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        clear();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove();
      }
    };
    // Clicking anywhere else lets go (menus, dialogs and toasts don't count).
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || root.current?.contains(target)) return;
      if (target.closest("[role='menu'], [role='dialog'], [data-sonner-toaster], [data-radix-popper-content-wrapper]"))
        return;
      clear();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [count, clear, remove, root]);

  return {
    count,
    selected,
    isSelected: (id: string) => chosen.has(id),
    all: count > 0 && count === ids.length,
    toggle,
    toggleAll,
    clear,
    remove,
  };
}

/** The checkbox beside a row, or (with `mixed`) the header's select-all. */
export function RowCheckbox({
  checked,
  mixed = false,
  label,
  className = "",
  onToggle,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  className?: string;
  onToggle: (range: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      title={label}
      className={`db-row-check ${checked || mixed ? "is-checked" : ""} ${className}`}
      // Shift-click mustn't select the page's text on the way.
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event.shiftKey);
      }}
    >
      <span className="db-row-check-box" aria-hidden>
        {mixed ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

/** What can be done with the selected rows, in place of the view tabs. */
export function SelectionBar({
  count,
  onDelete,
  onClear,
  pin,
  onPin,
}: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
  /** Whether the rows can be pinned (some aren't yet) or unpinned (all are). */
  pin?: "pin" | "unpin";
  onPin?: (pin: boolean) => void;
}) {
  return (
    <div className="db-selection-bar" role="toolbar" aria-label="Selected rows">
      <span className="db-selection-count" role="status" aria-live="polite">
        {count} selected
      </span>
      {pin && onPin && (
        <button type="button" className="db-selection-action" onClick={() => onPin(pin === "pin")}>
          {pin === "pin" ? <Pin size={15} /> : <PinOff size={15} />}
          {pin === "pin" ? "Pin to top" : "Unpin"}
        </button>
      )}
      <button type="button" className="db-selection-action is-danger" onClick={onDelete}>
        <Trash2 size={15} />
        Delete
      </button>
      <button
        type="button"
        className="db-selection-action"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection (Esc)"
      >
        <X size={15} />
      </button>
    </div>
  );
}
