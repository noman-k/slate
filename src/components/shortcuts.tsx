"use client";
import type { ReactNode } from "react";
import { Popup } from "./ui/menu";
import { useKeys, useTouchOnly } from "./keys";

/** Shortcuts, written once (see lib/keys.ts) and shown the way this device names them. */
const SHORTCUTS: [string, string[]][] = [
  ["Find anything", ["Mod+K"]],
  ["Toggle sidebar", ["Mod+\\"]],
  ["Back / forward", ["Mod+[", "Mod+]"]],
  ["Bold", ["Mod+B"]],
  ["Italic", ["Mod+I"]],
  ["Insert a block", ["/"]],
  ["Undo", ["Mod+Z"]],
  ["Close menu", ["Escape"]],
];

/** On a phone or tablet without a keyboard, the same jobs by touch. */
const TOUCH_TIPS: [string, string][] = [
  ["Find anything", "Tap Search in the sidebar"],
  ["Insert a block", "Type / on a new line"],
  ["Block options", "Tap a block, then its ⋯"],
  ["Page options", "Tap ⋯ at the top"],
  ["Undo", "Tap the ↶ above the page"],
  ["Close menu", "Tap outside it"],
];

/** Help popover with shortcuts for this device; the trigger decides where it lives. */
export function ShortcutsPopover({
  trigger,
  align = "end",
  side = "top",
}: {
  trigger: ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  const { keys } = useKeys();
  const touchOnly = useTouchOnly();
  return (
    <Popup align={align} side={side} trigger={trigger}>
      <div className="shortcuts">
        {touchOnly ? (
          <>
            <strong>A few helpful tips</strong>
            {TOUCH_TIPS.map(([label, how]) => (
              <div key={label}>
                <span>{label}</span>
                <span className="shortcuts-how">{how}</span>
              </div>
            ))}
            <p>With a keyboard attached, the usual shortcuts work too.</p>
          </>
        ) : (
          <>
            <strong>A few helpful shortcuts</strong>
            {SHORTCUTS.map(([label, combos]) => (
              <div key={label}>
                <span>{label}</span>
                <span className="shortcuts-keys">
                  {combos.map((combo) => (
                    <kbd key={combo}>{keys(combo)}</kbd>
                  ))}
                </span>
              </div>
            ))}
            <p>Made for your notes, ideas, and everything in between.</p>
          </>
        )}
      </div>
    </Popup>
  );
}
