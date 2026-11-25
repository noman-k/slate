/**
 * Two hyphens become an em dash in text fields marked `data-smart-dash` (titles and names),
 * the way the page editor does it: "well--almost" → "well—almost". Arrows too: "->" → "→",
 * "<-" → "←", and "<->" → "↔". Backspace right after brings back what was typed. The change goes through the browser's own text insertion, so the field
 * sees an ordinary input event (React's onChange runs) and ⌘Z undoes it.
 */

type TextField = HTMLInputElement | HTMLTextAreaElement;

const field = (target: EventTarget | null): TextField | null =>
  (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.matches("[data-smart-dash]")
    ? target
    : null;

/** Replaces `from`–`to` with `text` as if typed. */
function insert(el: TextField, from: number, to: number, text: string) {
  el.setSelectionRange(from, to);
  if (!document.execCommand("insertText", false, text)) {
    // No execCommand: set the value and tell React about it.
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    setter?.call(el, el.value.slice(0, from) + text + el.value.slice(to));
    el.setSelectionRange(from + text.length, from + text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/**
 * What a character typed right after another becomes: the pair's key is the character
 * before the caret plus the one typed.
 */
const PAIRS: Record<string, string> = { "--": "—", "->": "→", "<-": "←", "←>": "↔" };

/** Where the caret was right after each one we made, and what was typed, so Backspace can undo it. */
const made = new WeakMap<TextField, { at: number; typed: string }>();

function onBeforeInput(event: InputEvent) {
  const el = field(event.target);
  if (!el) return;
  const at = el.selectionStart ?? 0;
  const typed = event.data && event.data.length === 1 ? el.value[at - 1] + event.data : "";
  const replacement = PAIRS[typed];
  if (event.inputType === "insertText" && replacement && !event.isComposing && at > 0 && at === el.selectionEnd) {
    event.preventDefault();
    insert(el, at - 1, at, replacement);
    made.set(el, { at, typed });
    return;
  }
  made.delete(el);
}

function onKeyDown(event: KeyboardEvent) {
  const el = field(event.target);
  if (!el || event.key !== "Backspace" || event.metaKey || event.ctrlKey || event.altKey) return;
  const at = el.selectionStart ?? 0;
  const last = made.get(el);
  if (last && last.at === at && at === el.selectionEnd && el.value[at - 1] === PAIRS[last.typed]) {
    event.preventDefault();
    insert(el, at - 1, at, last.typed);
  }
  made.delete(el);
}

/** Listens once for the whole document; returns how to stop. */
export function installSmartDash() {
  document.addEventListener("beforeinput", onBeforeInput, true);
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("beforeinput", onBeforeInput, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}
