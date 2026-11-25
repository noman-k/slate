/**
 * On a phone, the app fills what's actually visible: the screen above the keyboard and above
 * the browser's own floating bars (iOS 26 Safari's address and form bars sit below the visual
 * viewport while the keyboard is up). Without this the app is as tall as the whole screen, so
 * when the keyboard opens Safari pushes the page up to show the cursor and the top bar slides
 * under the status bar; with it, the top bar stays put, the page scrolls inside, and the
 * editing toolbar can sit right on top of the keyboard, as in Notion.
 *
 * Sets `--vv-top` and `--vv-height` on <html> (where the visible area starts, in the layout
 * viewport that fixed elements use, and how tall it is) and the `viewport-locked` class.
 */
export function lockToVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    root.style.setProperty("--vv-top", `${Math.max(0, viewport.offsetTop)}px`);
    root.style.setProperty("--vv-height", `${viewport.height}px`);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };
  apply();
  root.classList.add("viewport-locked");
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  return () => {
    if (frame) cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("scroll", schedule);
    root.classList.remove("viewport-locked");
    root.style.removeProperty("--vv-top");
    root.style.removeProperty("--vv-height");
  };
}
