"use client";
/**
 * Editing on a phone: a slim toolbar that sits just above the on-screen keyboard while a
 * page is being edited, as in Notion's and Apple Notes' mobile apps. A phone keyboard has
 * no Tab key, so this is where indenting lives (nesting to-dos and list items), along
 * with a to-do and bullet list, undo and redo, and Done to put the keyboard away.
 *
 * Its buttons never take focus from the text, so the keyboard stays up while you use them.
 */
import { useEffect, useState } from "react";
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

export function KeyboardToolbar({ editor }: { editor: Editor | null }) {
  const touch = useTouchOnly();
  const [focused, setFocused] = useState(false);
  const [, rerender] = useState(0);
  // How far the keyboard (or anything else) covers the bottom of the window.
  const [inset, setInset] = useState(0);

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

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !touch) return;
    const place = () => setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
    };
  }, [touch]);

  if (!touch || !editor || !focused || !editor.isEditable) return null;
  const keep = (event: React.PointerEvent | React.MouseEvent) => event.preventDefault();
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
      onClick={run}
    >
      {icon}
    </button>
  );
  return (
    <div className="keyboard-toolbar" role="toolbar" aria-label="Editing" style={{ bottom: inset }}>
      {button("Outdent", <IndentDecrease size={20} />, () => changeIndent(editor, true), canIndent(editor, true))}
      {button("Indent", <IndentIncrease size={20} />, () => changeIndent(editor, false), canIndent(editor, false))}
      <span className="keyboard-toolbar-divider" aria-hidden />
      {button("To-do list", <ListChecks size={20} />, () => editor.chain().focus().toggleTaskList().run(), true, editor.isActive("taskList"))}
      {button("Bulleted list", <List size={20} />, () => editor.chain().focus().toggleBulletList().run(), true, editor.isActive("bulletList"))}
      <span className="keyboard-toolbar-divider" aria-hidden />
      {button("Undo", <Undo2 size={20} />, () => editor.chain().focus().undo().run(), editor.can().undo())}
      {button("Redo", <Redo2 size={20} />, () => editor.chain().focus().redo().run(), editor.can().redo())}
      <button
        type="button"
        className="keyboard-toolbar-done"
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={() => {
          editor.commands.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        Done
      </button>
    </div>
  );
}
