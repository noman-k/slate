/**
 * Keyboard shortcuts, written once and shown the way each device names them.
 *
 * A shortcut is written like "Mod+Shift+X": `Mod` is ⌘ on Apple devices and Ctrl elsewhere
 * (every handler in Slate accepts either), then Shift, Alt and the key. Apple devices get
 * Apple's symbols in Apple's order (⌃⌥⇧⌘), without separators: "⇧⌘X". Windows and Linux get
 * words joined by "+": "Ctrl+Shift+X".
 */
export type KeyPlatform = "apple" | "other";

const APPLE_ORDER = ["Ctrl", "Alt", "Shift", "Mod"];
const OTHER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];
const APPLE_NAMES: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const OTHER_NAMES: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  Escape: "Esc",
};

/** "Mod+Shift+X" → "⇧⌘X" (Apple) or "Ctrl+Shift+X" (others). */
export function formatKeys(combo: string, platform: KeyPlatform): string {
  const parts = combo.split("+").filter(Boolean);
  // "+" itself as the key ("Mod++") leaves an empty last part.
  const key = combo.endsWith("++") ? "+" : (parts.pop() ?? "");
  const modifiers = parts.filter((part) => part in APPLE_NAMES);
  const order = platform === "apple" ? APPLE_ORDER : OTHER_ORDER;
  const names = platform === "apple" ? APPLE_NAMES : OTHER_NAMES;
  const sorted = order.filter((m) => modifiers.includes(m)).map((m) => names[m]);
  const shown = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return platform === "apple" ? [...sorted, shown].join("") : [...sorted, shown].join("+");
}

/** A label with its shortcut, for tooltips: "Undo (⌘Z)" or "Undo (Ctrl+Z)". */
export function withKeys(label: string, combo: string, platform: KeyPlatform) {
  return `${label} (${formatKeys(combo, platform)})`;
}

/** Apple devices (Mac, iPhone, iPad) name keys with ⌘; everything else with Ctrl. */
export function detectKeyPlatform(nav: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } }): KeyPlatform {
  const name = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(name) ? "apple" : "other";
}
