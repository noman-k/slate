"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
type Side = "top" | "right" | "bottom" | "left";

const NARROW = "(max-width: 560px)";
/**
 * On a phone there's no room beside a button for a menu: one asked to open to the side
 * opens below it instead (side-opening menus can't be nudged back on screen).
 */
function useSide(side: Side): Side {
  const narrow = useSyncExternalStore(
    (change) => {
      const query = matchMedia(NARROW);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(NARROW).matches,
    () => false,
  );
  return narrow && (side === "left" || side === "right") ? "bottom" : side;
}

/**
 * Dropdown menu. Radix flips it when there isn't room on `side`, keeps it 12px inside
 * the window, and the CSS caps its height to the space available so it scrolls.
 */
export function Menu({
  trigger,
  children,
  align = "start",
  side = "bottom",
  onOpenChange,
  returnFocus = true,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  side?: Side;
  onOpenChange?: (open: boolean) => void;
  /** False when choosing an item moves focus somewhere else (e.g. into the editor). */
  returnFocus?: boolean;
}) {
  // Escape (or a click outside) always hands focus back to the trigger; only choosing an
  // item may send it elsewhere.
  const escaped = useRef(false);
  const placed = useSide(side);
  return (
    <Dropdown.Root
      onOpenChange={(open) => {
        if (open) escaped.current = false;
        onOpenChange?.(open);
      }}
    >
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="menu-surface"
          side={placed}
          sideOffset={6}
          align={align}
          collisionPadding={12}
          onEscapeKeyDown={() => (escaped.current = true)}
          onPointerDownOutside={() => (escaped.current = true)}
          onCloseAutoFocus={(event) => {
            if (!returnFocus && !escaped.current) event.preventDefault();
          }}
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item className={`menu-item ${danger ? "danger" : ""}`} onSelect={onClick} disabled={disabled}>
      {children}
    </Dropdown.Item>
  );
}
export function MenuSeparator() {
  return <Dropdown.Separator className="menu-separator" />;
}
export function Popup({
  trigger,
  children,
  align = "start",
  side = "bottom",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  side?: Side;
}) {
  const placed = useSide(side);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu-surface" side={placed} sideOffset={6} align={align} collisionPadding={12}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  variant = "center",
  actions,
  heading,
  initialFocus,
  focusPanel = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** "peek" slides in from the right like a Notion side peek. */
  variant?: "center" | "peek";
  /** Extra header buttons, shown beside the close button. */
  actions?: ReactNode;
  /** Richer heading content (e.g. an icon and a link); `title` stays the plain name. */
  heading?: ReactNode;
  /** What gets focus when it opens (by default, the first focusable element). */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Focus the panel itself on open, not a control in it: for something opened to be read
   * (an existing record), so nothing is selected for editing and phones keep the keyboard
   * down. Escape, Tab and screen readers work from there as usual.
   */
  focusPanel?: boolean;
}) {
  const peek = variant === "peek";
  const surface = useRef<HTMLDivElement>(null);
  const sheet = useSheet(surface, open && !peek, () => onOpenChange(false));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={`modal-backdrop ${peek ? "peek-backdrop" : ""}`} />
        <Dialog.Content
          ref={surface}
          className={`${peek ? "peek-surface" : "modal-surface"} ${className}`}
          onOpenAutoFocus={(event) => {
            const target = initialFocus?.current ?? (focusPanel ? surface.current : null);
            if (!target) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
        >
          {peek ? (
            <div className="peek-heading">
              {/* Title on the left; actions and Close (X) at the top right, like dialogs. */}
              <Dialog.Title>{heading ?? title}</Dialog.Title>
              {actions}
              <Dialog.Close className="icon-button" aria-label="Close" title="Close (Esc)">
                <X size={18} />
              </Dialog.Close>
            </div>
          ) : (
            <div className="modal-heading" {...sheet}>
              {/* A phone shows dialogs as a sheet from the bottom: this handle drags it down to close. */}
              <span className="modal-grabber" aria-hidden />
              <Dialog.Title>{title}</Dialog.Title>
              <span className="modal-heading-actions">
                {actions}
                <Dialog.Close className="icon-button" aria-label="Close">
                  <X size={18} />
                </Dialog.Close>
              </span>
            </div>
          )}
          <Dialog.Description className={description ? "modal-description" : "sr-only"}>
            {description || title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export { Check };

/** Dialogs are sheets from the bottom on phones (see 04-dialogs.css). */
const PHONE_SHEET = "(max-width: 640px)";

/**
 * A phone's dialog sheet: it rides above the on-screen keyboard (iOS covers fixed elements
 * at the bottom with it), and its header drags it down; let go far enough, or with a flick,
 * and it closes, otherwise it springs back. Returns the header's pointer handlers.
 */
function useSheet(surface: RefObject<HTMLDivElement | null>, active: boolean, close: () => void) {
  const drag = useRef<{ start: number; at: number; time: number; distance: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const place = () => {
      const el = surface.current;
      if (!el) return;
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      el.style.setProperty("--keyboard-inset", `${Math.round(covered)}px`);
    };
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
    };
  }, [active, surface]);
  // The sheet the header belongs to (found from the event, so handlers don't hold the ref).
  const sheetOf = (event: React.PointerEvent<HTMLElement>) =>
    event.currentTarget.closest<HTMLElement>(".modal-surface");
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!matchMedia(PHONE_SHEET).matches || event.button !== 0) return;
    // The close button and anything else to tap in the header keep working.
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    drag.current = { start: event.clientY, at: event.clientY, time: event.timeStamp, distance: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    const el = sheetOf(event);
    if (el) el.style.transition = "none";
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const el = sheetOf(event);
    const gesture = drag.current;
    if (!gesture || !el) return;
    const distance = Math.max(0, event.clientY - gesture.start);
    drag.current = { ...gesture, at: event.clientY, distance };
    el.style.transform = `translateY(${distance}px)`;
  }, []);
  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const el = sheetOf(event);
      const gesture = drag.current;
      drag.current = null;
      if (!el || !gesture) return;
      const speed = gesture.distance / Math.max(1, event.timeStamp - gesture.time);
      el.style.transition = "";
      if (gesture.distance > Math.min(120, el.offsetHeight * 0.3) || (gesture.distance > 24 && speed > 0.5)) close();
      else el.style.transform = "";
    },
    [close],
  );
  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLElement>) => {
    drag.current = null;
    const el = sheetOf(event);
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
    }
  }, []);
  return active ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } : {};
}
