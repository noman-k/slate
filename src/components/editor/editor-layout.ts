/**
 * Where things go around the editor's text: the top-level blocks under a point (for the
 * block handles), and positions for popovers near the selection and the selection toolbar.
 */

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { isTouchOnly } from "../keys";

/** The selection toolbar's width (its buttons are larger on touch screens). */
const bubbleWidth = () => (isTouchOnly() ? 342 : 304);

export type TopBlock = { el: HTMLElement; pos: number; node: ProseMirrorNode; rect: DOMRect };

/** Top-level blocks with their DOM elements, in document order. */
export function topLevelBlocks(editor: Editor): Omit<TopBlock, "rect">[] {
  const elements = Array.from(editor.view.dom.children) as HTMLElement[];
  const blocks: Omit<TopBlock, "rect">[] = [];
  if (elements.length === editor.state.doc.childCount) {
    editor.state.doc.forEach((node, offset, index) => blocks.push({ el: elements[index], pos: offset, node }));
    return blocks;
  }
  // DOM and document disagree (mid-transaction): resolve each element instead.
  for (const el of elements)
    try {
      const resolved = editor.state.doc.resolve(editor.view.posAtDOM(el, 0));
      const pos = resolved.depth ? resolved.before(1) : resolved.pos;
      const node = editor.state.doc.nodeAt(pos);
      if (node && !blocks.some((block) => block.pos === pos)) blocks.push({ el, pos, node });
    } catch {
      /* Detached element. */
    }
  return blocks;
}

/** The top-level block at a vertical position (or the nearest within `reach` px). */
export function blockAtY(editor: Editor, y: number, reach = 12): TopBlock | null {
  let nearest: TopBlock | null = null;
  let distance = Infinity;
  for (const block of topLevelBlocks(editor)) {
    const rect = block.el.getBoundingClientRect();
    if (y >= rect.top && y <= rect.bottom) return { ...block, rect };
    const gap = y < rect.top ? rect.top - y : y - rect.bottom;
    if (gap < distance) {
      distance = gap;
      nearest = { ...block, rect };
    }
  }
  return distance <= reach ? nearest : null;
}

/** Places the link/image popover under the selection (above it when there's no room). */
export function popoverNearSelection(editor: Editor, height: number) {
  const rect = editor.view.dom.closest(".document-editor")?.getBoundingClientRect();
  if (!rect) return undefined;
  const { from, to } = editor.state.selection;
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const width = 360;
  const left = Math.min(Math.max(0, rect.width - width), Math.max(0, start.left - rect.left - 8));
  // Measure against the visible page (below the top bar), not the whole window, so a
  // popover never opens up under the top bar or off the bottom of the screen.
  const view = editor.view.dom.closest(".page-scroll")?.getBoundingClientRect();
  const top = view?.top ?? 0;
  const bottom = view?.bottom ?? window.innerHeight;
  const below = bottom - end.bottom - 16;
  const above = start.top - top - 16;
  // Below if it fits (or has more room than above); then shrink to the room there is.
  if (below >= height || below >= above)
    return { top: end.bottom - rect.top + 8, left, maxHeight: Math.max(160, Math.min(height, below)) };
  return { bottom: rect.bottom - start.top + 8, left, maxHeight: Math.max(160, Math.min(height, above)) };
}

/** Where the selection toolbar goes; null when it should be hidden. */
export function placeBubble(editor: Editor, wrapper: HTMLElement | null) {
  const { selection } = editor.state;
  if (
    !(selection instanceof TextSelection) ||
    selection.empty ||
    !editor.isFocused ||
    editor.isActive("codeBlock") ||
    !editor.state.doc.textBetween(selection.from, selection.to).trim()
  )
    return null;
  const start = editor.view.coordsAtPos(selection.from);
  const end = editor.view.coordsAtPos(selection.to);
  const rect = wrapper?.getBoundingClientRect();
  const center = (start.left + end.right) / 2 - (rect?.left || 0);
  const BUBBLE_WIDTH = bubbleWidth();
  // Near the top of the window there is no room above: show it under the selection.
  const below = start.top < 96;
  return {
    top: below ? end.bottom - (rect?.top || 0) + 8 : start.top - (rect?.top || 0) - 46,
    // Centred on the selection, kept inside the editor and at least 8px inside the window
    // (on a phone the editor reaches the screen's edges).
    left: Math.min(
      Math.min((rect?.width || 0) - BUBBLE_WIDTH, window.innerWidth - 8 - BUBBLE_WIDTH - (rect?.left || 0)),
      Math.max(0, 8 - (rect?.left || 0), center - BUBBLE_WIDTH / 2),
    ),
  };
}
