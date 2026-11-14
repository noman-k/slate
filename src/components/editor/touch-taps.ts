import type { EditorView } from "@tiptap/pm/view";

/**
 * Taps in the editor on touch screens. A finger on a to-do, a link or an image means "use
 * this", not "start typing here", so those taps don't put the cursor in the page and raise
 * the keyboard:
 *
 * - a to-do's checkbox toggles (at any time);
 * - while reading (the editor isn't focused), a link opens (Slate pages in place, others in
 *   a new tab) and an image is left as it is;
 * - while editing, links and images behave as usual, so a link's text can still be changed.
 *
 * Scrolls and long-presses aren't taps, so scrolling and selecting text work as always.
 *
 * A Slate page link is opened by whoever listens for `slate:open-page` on the editor (the
 * page view, without a reload); with no listener, the browser goes there.
 */
export const OPEN_PAGE_EVENT = "slate:open-page";
const TAP_DISTANCE = 10;
const TAP_TIME = 500;

export function touchTaps() {
  let start: { x: number; y: number; time: number } | null = null;
  return {
    touchstart(_view: EditorView, event: TouchEvent) {
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      start = touch ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
      return false;
    },
    touchend(view: EditorView, event: TouchEvent) {
      const began = start;
      start = null;
      const touch = event.changedTouches[0];
      if (!began || !touch || event.touches.length) return false;
      const moved = Math.hypot(touch.clientX - began.x, touch.clientY - began.y);
      if (moved > TAP_DISTANCE || Date.now() - began.time > TAP_TIME) return false;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return false;

      const box = target.closest('ul[data-type="taskList"] > li > label')?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (box) {
        // No synthetic click (which could focus the page); toggle it directly instead.
        event.preventDefault();
        box.click();
        return true;
      }
      if (view.hasFocus()) return false;

      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (link) {
        event.preventDefault();
        const href = link.getAttribute("href") || "";
        const page = internalPage(href);
        if (page) {
          const request = new CustomEvent(OPEN_PAGE_EVENT, { bubbles: true, cancelable: true, detail: { id: page } });
          // A listener cancels the event once it has opened the page.
          if (view.dom.dispatchEvent(request)) window.location.assign(href);
        } else window.open(href, "_blank", "noopener,noreferrer");
        return true;
      }
      if (target.closest("img")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  };
}

/** The page id in a link to a Slate page on this site (`/p/<id>`), if it is one. */
export function internalPage(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    return url.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
