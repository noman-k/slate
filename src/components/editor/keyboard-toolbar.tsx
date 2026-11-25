"use client";
/**
 * Editing on a phone: a toolbar that sits right on top of the on-screen keyboard while a page
 * is being edited, as in Notion. A phone keyboard has no Tab key, so this is where indenting
 * lives (nesting to-dos and list items), along with a to-do and bullet list, undo and redo,
 * and Done to put the keyboard away.
 *
 * The app is pinned to what's visible above the keyboard (lib/visual-viewport.ts), so the
 * toolbar is simply the bottom of that area; the line being edited is kept above it. It steps
 * aside while text is selected, for the formatting popup. Its buttons never take focus from
 * the text, so the keyboard stays up while you use them.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { IndentDecrease, IndentIncrease, List, ListChecks, Redo2, Undo2 } from "lucide-react";
import { useTouchOnly } from "../keys";

/** Indents (or outdents) where the cursor is, like Tab and Shift+Tab. True if it did. */
export function changeIndent(editor: Editor, outdent: boolean): boolean {
  if (editor.isActive("codeBlock")) {
    if (!outdent) return editor.commands.insertContent("  ");
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset);
    const count = before.endsWith("  ") ? 2 : before.endsWith("\t") ? 1 : 0;
    return count ? editor.commands.deleteRange({ from: $from.pos - count, to: $from.pos }) : false;
  }
  const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
  return outdent ? editor.commands.liftListItem(type) : editor.commands.sinkListItem(type);
}

const canIndent = (editor: Editor, outdent: boolean) => {
  if (editor.isActive("codeBlock")) return true;
  const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
  return outdent ? editor.can().liftListItem(type) : editor.can().sinkListItem(type);
};

/** The toolbar's height; the page keeps the line being edited at least this far up. */
export const KEYBOARD_TOOLBAR_HEIGHT = 48;

export function KeyboardToolbar({ editor }: { editor: Editor | null }) {
  const touch = useTouchOnly();
  const [focused, setFocused] = useState(false);
  const [, rerender] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const onFocus = () => {
      clearTimeout(blurTimer);
      setFocused(true);
    };
    // A moment's grace: a tap on the toolbar itself must not hide it first.
    const onBlur = () => {
      blurTimer = setTimeout(() => setFocused(editor.isFocused), 120);
    };
    const onChange = () => rerender((n) => n + 1);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    editor.on("transaction", onChange);
    return () => {
      clearTimeout(blurTimer);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
      editor.off("transaction", onChange);
    };
  }, [editor]);

  const visible = touch && !!editor && focused && editor.isEditable && editor.state.selection.empty;

  // The toolbar claims its touches from the very start (React can't: its touchstart
  // listeners are passive). Otherwise iOS treats the first tap after the keyboard comes
  // up as its own (a focus change or a hover) and the button never hears it.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const claim = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    root.addEventListener("touchstart", claim, { passive: false });
    return () => root.removeEventListener("touchstart", claim);
  }, [visible]);

  // When the keyboard comes up (or the visible area changes), the line being edited moves
  // back into view above the toolbar.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!visible || !editor || !viewport) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isFocused) editor.view.dispatch(editor.state.tr.scrollIntoView());
      });
    };
    viewport.addEventListener("resize", reveal);
    // The keyboard may have finished opening before this was listening: check once it has.
    reveal();
    const settled = setTimeout(reveal, 400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
      viewport.removeEventListener("resize", reveal);
    };
  }, [visible, editor]);

  if (!visible || !editor) return null;
  const keep = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();
  /**
   * iOS moves focus off the text when a button is tapped (closing the keyboard, and with
   * it this toolbar, before the click arrives). So a tap acts on touchend and cancels the
   * browser's own tap handling: focus, and the keyboard, stay where they are. A touch
   * that slid off the button (a scroll) does nothing.
   */
  const tap = (run: () => void) => (event: React.TouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const touch = event.changedTouches[0];
    const box = event.currentTarget.getBoundingClientRect();
    if (!touch || event.currentTarget.disabled) return;
    if (touch.clientX < box.left || touch.clientX > box.right || touch.clientY < box.top || touch.clientY > box.bottom)
      return;
    run();
  };
  const button = (label: string, icon: React.ReactNode, run: () => void, enabled = true, active = false) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!enabled}
      aria-pressed={active || undefined}
      className={active ? "is-active" : undefined}
      onPointerDown={keep}
      onMouseDown={keep}
      onTouchEnd={tap(run)}
      onClick={run}
    >
      {icon}
    </button>
  );
  return createPortal(
    <div ref={ref} className="keyboard-toolbar" role="toolbar" aria-label="Editing">
      {button("Outdent", <IndentDecrease size={20} />, () => changeIndent(editor, true), canIndent(editor, true))}
      {button("Indent", <IndentIncrease size={20} />, () => changeIndent(editor, false), canIndent(editor, false))}
      <span className="keyboard-toolbar-divider" aria-hidden />
      {button(
        "To-do list",
        <ListChecks size={20} />,
        () => editor.chain().focus().toggleTaskList().run(),
        true,
        editor.isActive("taskList"),
      )}
      {button(
        "Bulleted list",
        <List size={20} />,
        () => editor.chain().focus().toggleBulletList().run(),
        true,
        editor.isActive("bulletList"),
      )}
      <span className="keyboard-toolbar-divider" aria-hidden />
      {button("Undo", <Undo2 size={20} />, () => editor.chain().focus().undo().run(), editor.can().undo())}
      {button("Redo", <Redo2 size={20} />, () => editor.chain().focus().redo().run(), editor.can().redo())}
      <button
        type="button"
        className="keyboard-toolbar-done"
        onPointerDown={keep}
        onMouseDown={keep}
        onTouchEnd={tap(() => {
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        })}
        onClick={() => {
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        Done
      </button>
    </div>,
    document.body,
  );
}
