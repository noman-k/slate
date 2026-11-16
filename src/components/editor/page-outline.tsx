"use client";

/**
 * The page outline (Notion calls it the table of contents): a short line for each heading
 * down the right edge of the page, the one you're reading lit up. Point at it and it opens
 * into the headings' names; click one to go there.
 *
 * It sits in the page's scroll area (the `.page-outline-slot` there), so a page shown in the
 * side panel has none, and it only shows on pages with two or more headings.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { scrollBehavior } from "@/lib/utils";

interface Heading {
  pos: number;
  level: number;
  text: string;
}

const headingsOf = (editor: Editor) => {
  const found: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      found.push({ pos, level: node.attrs.level as number, text: node.textContent.trim() });
      return false;
    }
    return true;
  });
  return found;
};

const sameHeadings = (a: Heading[], b: Heading[]) =>
  a.length === b.length && a.every((h, i) => h.pos === b[i].pos && h.level === b[i].level && h.text === b[i].text);

const headingElement = (editor: Editor, pos: number) => {
  const dom = editor.view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
};

export function PageOutline({ editor }: { editor: Editor | null }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);

  // Find the page's scroll area; pages in the side panel have no slot and get no outline.
  useEffect(() => {
    if (!editor) return;
    const find = () =>
      setSlot(
        editor.view.dom.closest(".page-scroll")?.querySelector<HTMLElement>(":scope > .page-outline-slot") ?? null,
      );
    find();
    // The editor's DOM may join the page a moment after the editor exists.
    const frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  // Keep the list of headings as the page changes.
  useEffect(() => {
    if (!editor) return;
    const read = () =>
      setHeadings((current) => {
        const next = headingsOf(editor);
        return sameHeadings(current, next) ? current : next;
      });
    read();
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);

  // The heading you're reading: the last one above a line a little way down the page.
  useEffect(() => {
    if (!editor || !slot || headings.length < 2) return;
    const scroller = slot.parentElement!;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = scroller.getBoundingClientRect().top + Math.min(160, scroller.clientHeight * 0.3);
      let current = 0;
      headings.forEach((heading, index) => {
        const element = headingElement(editor, heading.pos);
        if (element && element.getBoundingClientRect().top <= line) current = index;
      });
      // At the very bottom, the last heading counts even if it never reaches the line.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = headings.length - 1;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, slot, headings]);

  if (!editor || !slot || headings.length < 2) return null;
  const top = Math.min(...headings.map((h) => h.level));

  const go = (heading: Heading, index: number) => {
    const element = headingElement(editor, heading.pos);
    if (!element) return;
    element.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    setActive(index);
  };

  return createPortal(
    <nav className="page-outline" aria-label="Page outline">
      <div className="page-outline-lines" aria-hidden>
        {headings.map((heading, index) => (
          <span
            key={heading.pos}
            className={`page-outline-line level-${heading.level - top + 1}${index === active ? " is-active" : ""}`}
          />
        ))}
      </div>
      <ol className="page-outline-panel menu-surface">
        {headings.map((heading, index) => (
          <li key={heading.pos}>
            <button
              type="button"
              className={`level-${heading.level - top + 1}${index === active ? " is-active" : ""}`}
              aria-current={index === active ? "location" : undefined}
              onClick={(event) => {
                go(heading, index);
                event.currentTarget.blur();
              }}
            >
              {heading.text || "Untitled heading"}
            </button>
          </li>
        ))}
      </ol>
    </nav>,
    slot,
  );
}
