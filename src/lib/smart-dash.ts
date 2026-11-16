/**
 * Two hyphens become an em dash in text fields marked `data-smart-dash` (titles and names),
 * the way the page editor does it: "well--almost" → "well—almost". Backspace right after
 * brings "--" back. The change goes through the browser's own text insertion, so the field
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

/** Where the caret was right after each dash we made, so Backspace there can undo it. */
const made = new WeakMap<TextField, number>();

function onBeforeInput(event: InputEvent) {
  const el = field(event.target);
  if (!el) return;
  const at = el.selectionStart ?? 0;
  if (
    event.inputType === "insertText" &&
    event.data === "-" &&
    !event.isComposing &&
    at === el.selectionEnd &&
    el.value[at - 1] === "-"
  ) {
    event.preventDefault();
    insert(el, at - 1, at, "—");
    made.set(el, at);
    return;
  }
  made.delete(el);
}

function onKeyDown(event: KeyboardEvent) {
  const el = field(event.target);
  if (!el || event.key !== "Backspace" || event.metaKey || event.ctrlKey || event.altKey) return;
  const at = el.selectionStart ?? 0;
  if (made.get(el) === at && at === el.selectionEnd && el.value[at - 1] === "—") {
    event.preventDefault();
    insert(el, at - 1, at, "--");
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
