"use client";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check } from "lucide-react";
import type { ReactNode, RefObject } from "react";
type Side = "top" | "right" | "bottom" | "left";

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
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  side?: Side;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dropdown.Root onOpenChange={onOpenChange}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="menu-surface"
          side={side}
          sideOffset={6}
          align={align}
          collisionPadding={12}
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
    <Dropdown.Item
      className={`menu-item ${danger ? "danger" : ""}`}
      onSelect={onClick}
      disabled={disabled}
    >
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
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="menu-surface"
          side={side}
          sideOffset={6}
          align={align}
          collisionPadding={12}
        >
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
}) {
  const peek = variant === "peek";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`modal-backdrop ${peek ? "peek-backdrop" : ""}`}
        />
        <Dialog.Content
          className={`${peek ? "peek-surface" : "modal-surface"} ${className}`}
          onOpenAutoFocus={
            initialFocus
              ? (event) => {
                  if (!initialFocus.current) return;
                  event.preventDefault();
                  initialFocus.current.focus();
                }
              : undefined
          }
        >
          {peek ? (
            <div className="peek-heading">
              {/* Title on the left; actions and Close (X) at the top right, like dialogs. */}
              <Dialog.Title>{heading ?? title}</Dialog.Title>
              {actions}
              <Dialog.Close
                className="icon-button"
                aria-label="Close"
                title="Close (Esc)"
              >
                <X size={18} />
              </Dialog.Close>
            </div>
          ) : (
            <div className="modal-heading">
              <Dialog.Title>{title}</Dialog.Title>
              <span className="modal-heading-actions">
                {actions}
                <Dialog.Close className="icon-button" aria-label="Close">
                  <X size={18} />
                </Dialog.Close>
              </span>
            </div>
          )}
          <Dialog.Description
            className={description ? "modal-description" : "sr-only"}
          >
            {description || title}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export { Check };
