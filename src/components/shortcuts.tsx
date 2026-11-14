"use client";
import type { ReactNode } from "react";
import { Popup } from "./ui/menu";

const SHORTCUTS = [
  ["Find anything", "⌘ K"],
  ["Toggle sidebar", "⌘ \\"],
  ["Back / forward", "⌘ [ · ⌘ ]"],
  ["Bold", "⌘ B"],
  ["Italic", "⌘ I"],
  ["Insert a block", "/"],
  ["Undo", "⌘ Z"],
  ["Close menu", "Esc"],
];

/** Help popover with keyboard shortcuts; the trigger decides where it lives. */
export function ShortcutsPopover({
  trigger,
  align = "end",
  side = "top",
}: {
  trigger: ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <Popup align={align} side={side} trigger={trigger}>
      <div className="shortcuts">
        <strong>A few helpful shortcuts</strong>
        {SHORTCUTS.map(([label, key]) => (
          <div key={label}>
            <span>{label}</span>
            <kbd>{key}</kbd>
          </div>
        ))}
        <p>Made for your notes, ideas, and everything in between.</p>
      </div>
    </Popup>
  );
}
