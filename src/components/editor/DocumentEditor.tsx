"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { scrollBehavior } from "@/lib/utils";
import type { Editor } from "@tiptap/core";
import { EditorState as ProseMirrorState, TextSelection } from "@tiptap/pm/state";

import { closeHistory } from "@tiptap/pm/history";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { markdown as markdownLanguage, markdownLanguage as gfmLanguage } from "@codemirror/lang-markdown";
import { applyMarkdown, githubMarkdownLook, markdownKeymap, type MarkdownAction } from "./markdown-source";
import { basicSetup } from "codemirror";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  FileText,
  GripVertical,
  Plus,
  Copy,
  Trash2,
  ArrowUp,
  ArrowDown,
  Code2,
  ListChecks,
  Undo2,
  Redo2,
  Check,
  AlertTriangle,
  ClipboardCopy,
} from "lucide-react";
import { toast } from "sonner";
import { safeImageUrl } from "../../lib/markdown";
import { createDocumentExtensions, parseDocument, EmbedContext, type EmbedOptions } from "./extensions";
import { OPEN_PAGE_EVENT, touchTaps } from "./touch-taps";
import { setRunFrom } from "./procedure-nodes";
import { EditorUrlPopover } from "./EditorUrlPopover";
import { DatabasePicker, type DatabaseChoice } from "./DatabasePicker";
import "./editor.css";
import { isTouchOnly, useKeys } from "../keys";
import { KeyboardToolbar, changeIndent } from "./keyboard-toolbar";
import { blockAtY, placeBubble, popoverNearSelection, type TopBlock } from "./editor-layout";
import { buildSlashItems, filterSlashItems, type DbPicker, type SlashItem, type UrlInput } from "./slash-items";
export interface DocumentEditorProps {
  pageId: string;
  markdown: string;
  onChange: (markdown: string) => void;
  onUploadImage?: (file: File) => Promise<string>;
  onCreatePage?: () => string | void;
  /** Creates a database here, shown first as a table, board or list. */
  onCreateDatabase?: (view?: "table" | "board" | "list") => string;
  /** Lets the page undo in this editor (e.g. from a toast's Undo button). */
  onHistoryApi?: (pageId: string, api: { undo: () => void } | null) => void;
  /** Databases that can be shown here as a linked view (for "/linked database"). */
  listDatabases?: () => DatabaseChoice[];
  onOpenPage?: (id: string) => void;
  renderDatabase?: (id: string, block?: string) => ReactNode;
  /** Links an existing database here: sets up the block's own views, returns its id. */
  onLinkDatabase?: (databaseId: string) => string;
  resolvePage?: EmbedOptions["resolvePage"];
  /**
   * Opens the playbook template gallery; the chosen template's Markdown comes back
   * through `insert`, which puts it where the slash command was typed.
   */
  /** Opens the template gallery; the new playbook page's id comes back to be linked here. */
  onInsertProcedure?: (insert: (pageId: string) => void) => void;
  /** Starts a run of this page at a section (from the section heading). */
  onRunFrom?: (section: string) => void;
  /** Turns a to-do list's items into a runnable checklist page; returns its id. */
  onMakeChecklist?: (items: string[]) => string | void;
  /**
   * A playbook or runbook: its steps are structured blocks, so the page is edited in
   * the editor only (like a database page) unless `editSource` is on.
   */
  runnable?: boolean;
  /** "Edit anyway" from View as Markdown: open the source of a runnable page. */
  editSource?: boolean;
  onEditSourceChange?: (on: boolean) => void;
}

interface SlashState {
  from: number;
  to: number;
  query: string;
  /** Distance from the wrapper's top (opens below) or bottom (opens above). */
  top?: number;
  bottom?: number;
  left: number;
}
const SLASH_MENU_WIDTH = 300;
const SLASH_MENU_HEIGHT = 360;

/** The Markdown mark, as GitHub shows under its editors. */
function MarkdownMark() {
  return (
    <svg width="16" height="10" viewBox="0 0 208 128" aria-hidden className="md-mark">
      <rect x="5" y="5" width="198" height="118" rx="10" fill="none" stroke="currentColor" strokeWidth="10" />
      <path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0-30-33h20V30h20v35h20z" fill="currentColor" />
    </svg>
  );
}

/**
 * Replaces the document without an undo step: loading a page or returning from Markdown
 * mode must not be undoable, or ⌘Z right after opening a page would empty it.
 */
function loadDocument(editor: Editor, source: string) {
  editor.chain().setMeta("addToHistory", false).setContent(parseDocument(editor, source), { emitUpdate: false }).run();
  // setContent can leave the selection *on* a block such as a page link. It is
  // invisible until the editor gains focus, then that block lights up in blue.
  // Park a plain text cursor in the first place that takes text instead.
  const { doc } = editor.state;
  let textAt = -1;
  doc.descendants((node, pos) => {
    if (textAt >= 0) return false;
    if (node.isTextblock) textAt = pos + 1;
    return textAt < 0;
  });
  const selection = textAt >= 0 ? TextSelection.create(doc, textAt) : TextSelection.atEnd(doc);
  editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta("addToHistory", false));
}

/** Rebuilds the editor state with the same document and plugins but empty undo history. */
function resetHistory(editor: Editor) {
  const { state } = editor;
  editor.view.updateState(
    ProseMirrorState.create({ doc: state.doc, plugins: state.plugins, selection: state.selection }),
  );
}

function countSource(value: string) {
  return {
    lines: value ? value.split("\n").length : 0,
    words: (value.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length,
  };
}

/** GitHub-style toolbar groups for the Markdown source editor. */
const MARKDOWN_TOOLS: { action: MarkdownAction; label: string; icon: typeof FileText; keys?: string }[][] = [
  [
    { action: "h1", label: "Heading 1", icon: Heading1 },
    { action: "h2", label: "Heading 2", icon: Heading2 },
    { action: "h3", label: "Heading 3", icon: Heading3 },
  ],
  [
    { action: "bold", label: "Bold", icon: Bold, keys: "Mod+B" },
    { action: "italic", label: "Italic", icon: Italic, keys: "Mod+I" },
    { action: "strike", label: "Strikethrough", icon: Strikethrough, keys: "Shift+Mod+X" },
  ],
  [
    { action: "quote", label: "Quote", icon: Quote, keys: "Shift+Mod+." },
    { action: "code", label: "Code", icon: Code, keys: "Mod+E" },
    { action: "link", label: "Link", icon: Link2, keys: "Mod+K" },
  ],
  [
    { action: "bullet", label: "Bulleted list", icon: List, keys: "Shift+Mod+8" },
    { action: "numbered", label: "Numbered list", icon: ListOrdered, keys: "Shift+Mod+7" },
    { action: "task", label: "Task list", icon: CheckSquare },
  ],
];
interface BlockHover {
  position: number;
  /** Handle position, centered on the block's first line (wrapper-relative). */
  top: number;
  /** The block's box, for the highlight shown while it is the menu or drag target. */
  box: { top: number; height: number };
}

export function DocumentEditor(props: DocumentEditorProps) {
  const shortcut = useKeys();
  const {
    pageId,
    markdown,
    onChange,
    onUploadImage,
    onCreatePage,
    onCreateDatabase,
    listDatabases,
    onHistoryApi,
    onOpenPage,
    renderDatabase,
    onLinkDatabase,
    resolvePage,
    onInsertProcedure,
    onRunFrom,
    onMakeChecklist,
    runnable,
    editSource,
    onEditSourceChange,
  } = props;
  const [mode, setMode] = useState<"interactive" | "markdown">("interactive");
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [hover, setHover] = useState<BlockHover | null>(null);
  const [blockMenu, setBlockMenu] = useState(false);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [urlInput, setUrlInput] = useState<UrlInput>(null);
  /** "/linked database": choose an existing database (or a new one) to show here. */
  const [dbPicker, setDbPicker] = useState<DbPicker>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sourceHostRef = useRef<HTMLDivElement>(null);
  const [sourceStats, setSourceStats] = useState({ lines: 0, words: 0 });
  /** Undo/redo depth of the Markdown source editor, for the toolbar buttons. */
  const [sourceHistory, setSourceHistory] = useState({ undo: 0, redo: 0 });
  const sourceEditorRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef(markdown);
  const sourceRef = useRef(markdown);
  const changeRef = useRef(onChange);
  const uploadRef = useRef(onUploadImage);
  const touchHandlers = useMemo(() => touchTaps(), []);
  /** Whether the pointer that's down is a finger (see the editor's onClick). */
  const tapping = useRef(false);
  const slashHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  /** Where the "/" was that Escape dismissed: typing on doesn't reopen it. */
  const dismissedSlash = useRef<number | null>(null);
  const draggedBlock = useRef<number | null>(null);
  /** Boundary position where a dragged block would land. */
  const dropTarget = useRef<number | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const [draggingBlock, setDraggingBlock] = useState(false);
  const hoverElement = useRef<HTMLElement | null>(null);
  const selectingRef = useRef(false);
  const blockKeysRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const blockMenuRef = useRef<HTMLDivElement>(null);
  const [menuPlacement, setMenuPlacement] = useState<{ top?: number; bottom?: number }>({});
  const linkRef = useRef<() => void>(() => {});
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    uploadRef.current = onUploadImage;
  }, [onUploadImage]);
  const insertImageRef = useRef<(file: File, at?: number) => Promise<void>>(async () => {});
  const extensions = useMemo(() => createDocumentExtensions(), []);
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content: "",
      editorProps: {
        attributes: {
          class: "slate-prose",
          "aria-label": "Page content",
          spellcheck: "true",
        },
        handleKeyDown: (_view, event) => {
          if (slashHandlerRef.current(event)) return true;
          if (blockKeysRef.current(event)) return true;
          // Typing hides the block handles until the mouse moves again, like Notion.
          if (!event.metaKey && !event.ctrlKey) setHover(null);
          const current = editorRef.current;
          // ⌘K on selected text adds a link (with nothing selected, ⌘K still opens search).
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "k" &&
            current &&
            !current.state.selection.empty
          ) {
            event.preventDefault();
            event.stopPropagation();
            linkRef.current();
            return true;
          }
          // Tab nests list items and to-dos (and indents code); on a phone, the keyboard
          // toolbar's Indent and Outdent do the same.
          if (event.key === "Tab" && current) {
            const inCode = current.isActive("codeBlock");
            if (changeIndent(current, event.shiftKey) || inCode) {
              event.preventDefault();
              return true;
            }
          }
          return false;
        },
        // Touch: to-dos, links and images respond to a tap without raising the keyboard.
        handleDOMEvents: touchHandlers,
        handleClick: (_view, _pos, event) => {
          const link = (event.target as HTMLElement).closest?.("a[href]");
          if (!link || !(event.metaKey || event.ctrlKey)) return false;
          window.open(link.getAttribute("href") || "", "_blank", "noopener,noreferrer");
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          // Blocks dragged by their handle are moved by the wrapper's drop handler.
          if (event.dataTransfer?.types.includes("application/x-slate-block")) return true;
          if (moved) return false;
          const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith("image/"));
          if (!file) return false;
          event.preventDefault();
          const target = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          void insertImageRef.current(file, target?.pos);
          return true;
        },
        handlePaste: (view, event) => {
          const image = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
          if (image) {
            event.preventDefault();
            void insertImageRef.current(image);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain");
          if (
            !text ||
            event.clipboardData?.getData("text/html") ||
            !/(^#{1,3} |^```|^\|.+\||^:::slate |^[-*] |^> )/m.test(text)
          )
            return false;
          event.preventDefault();
          const current = editorRef.current;
          if (current) current.commands.insertContent(parseDocument(current, text).content || []);
          return !!view;
        },
      },
      onUpdate: ({ editor: current }) => {
        const value = current.getMarkdown();
        lastEmitted.current = value;
        sourceRef.current = value;
        changeRef.current(value);
        const { $from } = current.state.selection;
        const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
        // "/" at the start of a line or after a space opens the menu; a space closes it.
        const match = before.match(/(?:^|\s)\/([^\s/]{0,30})$/);
        const slashAt = match ? $from.pos - match[1].length - 1 : -1;
        if (!match) dismissedSlash.current = null;
        if (match && $from.parent.type.name === "paragraph" && dismissedSlash.current !== slashAt) {
          const rect = wrapperRef.current?.getBoundingClientRect();
          const caret = current.view.coordsAtPos($from.pos);
          // Open upward when the caret is near the bottom of the window.
          const above = window.innerHeight - caret.bottom < SLASH_MENU_HEIGHT && caret.top > SLASH_MENU_HEIGHT;
          const maxLeft = Math.max(0, (rect?.width || 0) - SLASH_MENU_WIDTH);
          setSlash({
            from: slashAt,
            to: $from.pos,
            query: match[1],
            ...(above ? { bottom: (rect?.bottom || 0) - caret.top + 6 } : { top: caret.bottom - (rect?.top || 0) + 6 }),
            left: Math.min(maxLeft, Math.max(0, caret.left - (rect?.left || 0) - 10)),
          });
          setSlashIndex(0);
        } else setSlash(null);
      },
      onSelectionUpdate: ({ editor: current }) => {
        setTick((value) => value + 1);
        // While the mouse is still dragging out a selection, wait for mouseup.
        setBubble(selectingRef.current ? null : placeBubble(current, wrapperRef.current));
      },
    },
    [pageId],
  );
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
    /** Uploads a pasted or dropped image and inserts it where it landed. */
    insertImageRef.current = async (file, at) => {
      const upload = uploadRef.current;
      if (!upload) {
        toast("Image uploads need a signed-in workspace.", {
          description: "Type /image to embed one from a link instead.",
        });
        return;
      }
      const pending = toast.loading("Uploading image…");
      try {
        const src = await upload(file);
        if (!editor || editor.isDestroyed) return;
        editor
          .chain()
          .focus()
          .insertContentAt(at ?? editor.state.selection.to, {
            type: "image",
            attrs: { src, alt: file.name },
          })
          .run();
        toast.success("Image added", { id: pending });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The image could not be uploaded.", { id: pending });
      }
    };
  }, [editor]);

  // Which editor instance has received its content. Checking for text instead would
  // re-load (and wipe redo) whenever undo empties the page.
  const loadedEditor = useRef<Editor | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (markdown === lastEmitted.current && loadedEditor.current === editor) return;
    sourceRef.current = markdown;
    lastEmitted.current = markdown;
    loadedEditor.current = editor;
    loadDocument(editor, markdown);
  }, [editor, markdown, pageId]);

  useEffect(() => {
    if (!editor) return;
    const match = window.location.hash.match(/^#block-(\d+)$/);
    if (!match) return;
    const position = Number(match[1]);
    if (position >= editor.state.doc.content.size) return;
    const element = editor.view.nodeDOM(position);
    if (element instanceof HTMLElement) element.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }, [editor, pageId]);

  useEffect(() => {
    wrapperRef.current
      ?.querySelector('.slash-command-menu [aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [slashIndex, slash?.query]);

  useEffect(() => {
    if (mode !== "markdown" || !sourceHostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: sourceRef.current,
        extensions: [
          basicSetup,
          markdownLanguage({ base: gfmLanguage }),
          githubMarkdownLook,
          markdownKeymap,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Markdown source" }),
          keymap.of([
            {
              key: "Escape",
              run: () => {
                view.contentDOM.blur();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            const undoCount = undoDepth(update.state);
            const redoCount = redoDepth(update.state);
            setSourceHistory((current) =>
              current.undo === undoCount && current.redo === redoCount ? current : { undo: undoCount, redo: redoCount },
            );
            if (update.docChanged) {
              const value = update.state.doc.toString();
              sourceRef.current = value;
              lastEmitted.current = value;
              changeRef.current(value);
              setSourceStats(countSource(value));
            }
          }),
        ],
      }),
      parent: sourceHostRef.current,
    });
    sourceEditorRef.current = view;
    setSourceStats(countSource(sourceRef.current));
    setSourceHistory({ undo: 0, redo: 0 });
    return () => {
      sourceEditorRef.current = null;
      view.destroy();
    };
  }, [mode, pageId]);

  const allItems: SlashItem[] = useMemo(
    () =>
      buildSlashItems({
        onCreatePage,
        onCreateDatabase,
        onUploadImage,
        listDatabases,
        onInsertProcedure,
        setDbPicker,
        setUrlInput,
      }),
    [onCreatePage, onCreateDatabase, onUploadImage, listDatabases, onInsertProcedure],
  );
  const filteredItems = useMemo(
    () => filterSlashItems(allItems, slash?.query || "", runnable, editor),
    [allItems, slash?.query, runnable, editor],
  );
  const runSlash = useCallback(
    (item: SlashItem) => {
      if (!editor || !slash) return;
      // Also drop the space typed before a mid-line "/", so no trailing space is left.
      const $slash = editor.state.doc.resolve(slash.from);
      const spaceBefore =
        $slash.parentOffset > 0 &&
        editor.state.doc.textBetween(slash.from - 1, slash.from) === " " &&
        !editor.state.doc.textBetween(slash.to, $slash.end()).trim();
      editor
        .chain()
        .focus()
        .deleteRange({ from: spaceBefore ? slash.from - 1 : slash.from, to: slash.to })
        .run();
      setSlash(null);
      // Typed mid-line: keep that text and put the new block on its own line below.
      const { $from } = editor.state.selection;
      if ($from.depth > 0 && $from.parent.textContent.trim()) {
        const after = $from.after();
        editor
          .chain()
          .insertContentAt(after, { type: "paragraph" })
          .setTextSelection(after + 1)
          .run();
      }
      item.run(editor);
    },
    [editor, slash],
  );
  useEffect(() => {
    slashHandlerRef.current = (event) => {
      if (!slash) return false;
      const count = filteredItems.length;
      const move = (to: number) => {
        event.preventDefault();
        if (count) setSlashIndex(((to % count) + count) % count);
        return true;
      };
      if (event.isComposing) return false;
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) return move(slashIndex + 1);
      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) return move(slashIndex - 1);
      if (event.key === "Home") return move(0);
      if (event.key === "End") return move(count - 1);
      if (event.key === "Enter" && count) {
        event.preventDefault();
        runSlash(filteredItems[Math.min(slashIndex, count - 1)]);
        return true;
      }
      if (event.key === "Escape") {
        // Keep the "/" as typed text, and don't reopen the menu for it.
        dismissedSlash.current = slash.from;
        setSlash(null);
        return true;
      }
      return false;
    };
  }, [slash, slashIndex, filteredItems, runSlash]);

  // Screen readers: the editor keeps focus, so point it at the highlighted option.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    if (slash && filteredItems.length) {
      dom.setAttribute("aria-controls", "slash-command-menu");
      dom.setAttribute("aria-activedescendant", `slash-option-${slashIndex}`);
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }, [editor, slash, slashIndex, filteredItems.length]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSlash(null);
        setBlockMenu(false);
        setBubble(null);
        setUrlInput(null);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);

  /** The toolbar undo/redo act on whichever editor is showing. */
  const runHistory = (action: "undo" | "redo") => {
    if (mode === "markdown") {
      const view = sourceEditorRef.current;
      if (!view) return;
      if (action === "undo") undo(view);
      else redo(view);
      view.focus();
      return;
    }
    if (action === "undo") editor?.chain().focus().undo().run();
    else editor?.chain().focus().redo().run();
  };
  const historyRef = useRef(runHistory);
  useEffect(() => {
    historyRef.current = runHistory;
  });
  useEffect(() => {
    onHistoryApi?.(pageId, { undo: () => historyRef.current("undo") });
    return () => onHistoryApi?.(pageId, null);
  }, [onHistoryApi, pageId]);
  // Section headings offer "Run from here" when the page can run.
  const runFromRef = useRef(onRunFrom);
  useEffect(() => {
    runFromRef.current = onRunFrom;
  });
  const canRunFrom = !!onRunFrom;
  useEffect(() => {
    if (editor) setRunFrom(editor, canRunFrom ? (section) => runFromRef.current?.(section) : null);
  }, [editor, canRunFrom]);
  const switchMode = (next: typeof mode) => {
    if (next === mode || !editor) return;
    if (next === "interactive") {
      loadDocument(editor, sourceRef.current);
      // Edits made in Markdown mode have their own history there; the interactive
      // history no longer applies to this content, so start it fresh.
      resetHistory(editor);
      setTick((value) => value + 1);
    }
    setSlash(null);
    setBubble(null);
    setHover(null);
    setBlockMenu(false);
    setDbPicker(null);
    setMode(next);
  };
  // A runnable page shows only the editor, unless its source was opened on purpose;
  // closing the source (or the page becoming runnable while in Markdown) returns to it.
  const switchModeRef = useRef(switchMode);
  useEffect(() => {
    switchModeRef.current = switchMode;
  });
  const wantedMode = runnable && !editSource ? "interactive" : editSource ? "markdown" : null;
  useEffect(() => {
    if (!wantedMode || wantedMode === mode || !editor) return;
    queueMicrotask(() => switchModeRef.current(wantedMode));
  }, [wantedMode, mode, editor]);
  const showModeSwitch = !runnable || editSource;
  const setLink = () => {
    if (editor)
      setUrlInput({
        kind: "link",
        value: String(editor.getAttributes("link").href || ""),
        position: popoverNearSelection(editor, 130),
      });
  };
  useEffect(() => {
    linkRef.current = setLink;
  });
  const submitUrl = (value: string) => {
    if (!editor || editor.isDestroyed || !urlInput) return;
    if (urlInput.kind === "image") {
      const src = safeImageUrl(value);
      if (!src) {
        toast.error("Enter a valid HTTP or HTTPS image URL.");
        return;
      }
      editor.chain().focus().setImage({ src }).run();
    } else if (!value) editor.chain().focus().unsetLink().run();
    else {
      try {
        if (!["http:", "https:", "mailto:"].includes(new URL(value).protocol)) throw new Error();
        editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
      } catch {
        toast.error("Enter a valid HTTP, HTTPS, or email link.");
        return;
      }
    }
    setUrlInput(null);
  };
  type BlockActionName =
    | "text"
    | "heading1"
    | "heading2"
    | "heading3"
    | "bullet"
    | "numbered"
    | "todo"
    | "quote"
    | "code"
    | "duplicate"
    | "copy"
    | "link"
    | "up"
    | "down"
    | "delete";
  /** Paragraphs and headings can be turned into other block types. */
  const TURN_INTO: BlockActionName[] = [
    "text",
    "heading1",
    "heading2",
    "heading3",
    "bullet",
    "numbered",
    "todo",
    "quote",
    "code",
  ];
  /** Block operations are always their own undo step, never merged with typing. */
  const newUndoStep = () => {
    if (editor) editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const blockAction = async (action: BlockActionName, at = hover?.position) => {
    if (!editor || at === undefined) return;
    const node = editor.state.doc.nodeAt(at);
    if (!node) return;
    newUndoStep();
    const end = at + node.nodeSize;
    const turn = editor
      .chain()
      .focus()
      .setTextSelection(at + 1);
    if (TURN_INTO.includes(action) && !node.isTextblock) return;
    if (action === "text") turn.setParagraph().run();
    if (action === "heading1") turn.setHeading({ level: 1 }).run();
    if (action === "heading2") turn.setHeading({ level: 2 }).run();
    if (action === "heading3") turn.setHeading({ level: 3 }).run();
    if (action === "bullet") turn.setParagraph().toggleBulletList().run();
    if (action === "numbered") turn.setParagraph().toggleOrderedList().run();
    if (action === "todo") turn.setParagraph().toggleTaskList().run();
    if (action === "quote") turn.setParagraph().toggleBlockquote().run();
    if (action === "code") turn.setCodeBlock().run();
    if (action === "delete") editor.chain().focus().deleteRange({ from: at, to: end }).run();
    if (action === "duplicate") editor.chain().focus().insertContentAt(end, node.toJSON()).run();
    if (action === "copy") {
      await navigator.clipboard.writeText(
        editor.markdown?.serialize({ type: "doc", content: [node.toJSON()] }) || node.textContent,
      );
      toast.success("Block copied");
    }
    if (action === "link") {
      const url = new URL(window.location.href);
      url.hash = `block-${at}`;
      await navigator.clipboard.writeText(url.href);
      toast.success("Block link copied");
    }
    if (action === "up" && at > 0) {
      const previous = editor.state.doc.resolve(at).nodeBefore;
      if (previous) moveBlock(at, at - previous.nodeSize);
    }
    if (action === "down" && end < editor.state.doc.content.size) {
      const next = editor.state.doc.nodeAt(end);
      if (next) moveBlock(at, end + next.nodeSize);
    }
    setBlockMenu(false);
    setHover(null);
  };
  /**
   * Moves the top-level block at `from` to the boundary `target`, keeping the caret at the
   * same offset inside it (`caretOffset`), or at its start.
   */
  const moveBlock = (from: number, target: number, caretOffset = 1) => {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(from);
    if (!node || (target >= from && target <= from + node.nodeSize)) return;
    const tr = editor.state.tr.delete(from, from + node.nodeSize);
    const insertAt = target > from ? target - node.nodeSize : target;
    tr.insert(insertAt, node);
    const inside = Math.min(insertAt + Math.max(1, caretOffset), insertAt + node.nodeSize - 1);
    tr.setSelection(TextSelection.near(tr.doc.resolve(inside)));
    tr.scrollIntoView();
    editor.view.dispatch(closeHistory(tr));
    editor.view.focus();
  };
  // Keyboard: ⇧⌘↑/↓ moves the current block, ⌘D duplicates it.
  useEffect(() => {
    blockKeysRef.current = (event) => {
      if (!editor || !(event.metaKey || event.ctrlKey)) return false;
      const { $from } = editor.state.selection;
      if ($from.depth === 0) return false;
      const at = $from.before(1);
      const node = editor.state.doc.nodeAt(at);
      if (!node) return false;
      const offset = $from.pos - at;
      if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        if (event.key === "ArrowUp") {
          const previous = editor.state.doc.resolve(at).nodeBefore;
          if (previous) moveBlock(at, at - previous.nodeSize, offset);
        } else {
          const end = at + node.nodeSize;
          const next = editor.state.doc.nodeAt(end);
          if (next) moveBlock(at, end + next.nodeSize, offset);
        }
        return true;
      }
      if (!event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        newUndoStep();
        editor
          .chain()
          .insertContentAt(at + node.nodeSize, node.toJSON())
          .run();
        return true;
      }
      return false;
    };
  });
  // The selection toolbar appears once a mouse selection is finished.
  useEffect(() => {
    const finish = () => {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      if (editor && !editor.isDestroyed) setBubble(placeBubble(editor, wrapperRef.current));
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [editor]);
  // A tapped link to a Slate page opens here, without reloading (see touch-taps.ts).
  useEffect(() => {
    const host = wrapperRef.current;
    if (!host || !onOpenPage) return;
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      event.preventDefault();
      onOpenPage(id);
    };
    host.addEventListener(OPEN_PAGE_EVENT, open);
    return () => host.removeEventListener(OPEN_PAGE_EVENT, open);
  }, [onOpenPage]);
  // Keyboard focus starts inside the block menu so arrows and Enter work at once.
  useEffect(() => {
    if (blockMenu) blockMenuRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [blockMenu]);
  /** Handle position for a block: centered on its first line. */
  const handleFor = (block: TopBlock) => {
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    // Embedded blocks: center on their heading row (a database's title, a page link).
    const heading = block.el.querySelector<HTMLElement>(".db-inline-title, .editor-page-reference");
    if (heading) {
      const rect = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      const top = rect.top + (parseFloat(style.paddingTop) || 0);
      const height = rect.height - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      return {
        position: block.pos,
        top: top + height / 2 - 12 - (wrapper?.top || 0),
        box: { top: block.rect.top - (wrapper?.top || 0), height: block.rect.height },
      };
    }
    const line = block.el.matches("ul, ol, blockquote, .editor-callout, [data-type=taskList]")
      ? (block.el.querySelector<HTMLElement>("p") ?? block.el)
      : block.el;
    const style = getComputedStyle(line);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 24;
    const lineTop = line.getBoundingClientRect().top + (parseFloat(style.paddingTop) || 0);
    return {
      position: block.pos,
      top: lineTop - (wrapper?.top || 0) + (lineHeight - 24) / 2,
      box: { top: block.rect.top - (wrapper?.top || 0), height: block.rect.height },
    };
  };
  const hoverBlock = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || mode !== "interactive" || blockMenu || draggedBlock.current !== null) return;
    // Picks the block by height, so the left gutter (where the handles live) counts too.
    const block = blockAtY(editor, event.clientY);
    if (!block) {
      setHover(null);
      return;
    }
    hoverElement.current = block.el;
    const next = handleFor(block);
    setHover((current) =>
      current &&
      current.position === next.position &&
      Math.abs(current.top - next.top) < 0.5 &&
      Math.abs(current.box.height - next.box.height) < 0.5
        ? current
        : next,
    );
  };
  const openBlockMenu = () => {
    const rect = hoverElement.current?.getBoundingClientRect();
    const wrapper = wrapperRef.current?.getBoundingClientRect();
    if (!rect || !wrapper || !hover) return;
    // Open upward when there isn't room below the block.
    setMenuPlacement(
      window.innerHeight - rect.bottom < 440 && rect.top > 440
        ? { bottom: wrapper.bottom - rect.top + 4 }
        : { top: hover.top + 30 },
    );
    setBlockMenu(true);
  };
  const addBlock = (above: boolean) => {
    if (!editor || !hover) return;
    const node = editor.state.doc.nodeAt(hover.position);
    if (!node) return;
    // An empty paragraph is reused; otherwise a new one goes below (Alt: above).
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor
        .chain()
        .focus()
        .setTextSelection(hover.position + 1)
        .insertContent("/")
        .run();
      return;
    }
    const at = above ? hover.position : hover.position + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(at + 2)
      .run();
  };
  const endBlockDrag = () => {
    draggedBlock.current = null;
    dropTarget.current = null;
    setDropLine(null);
    setDraggingBlock(false);
  };
  return (
    <div
      className={`document-editor ${draggingBlock ? "is-dragging-block" : ""}`}
      ref={wrapperRef}
      data-page-id={pageId}
      data-update={tick}
      // A mouse or pen shows a block's handles as it moves over it. A finger shows them for
      // the block it tapped, but only after the tap's click, and not for a tap on something
      // to use (a link, a page, a button): Safari treats a tap that makes anything appear
      // before its click as a hover, so the page or link would need a second tap.
      onPointerMove={(event) => {
        if (event.pointerType !== "touch") hoverBlock(event);
      }}
      onPointerDown={(event) => {
        tapping.current = event.pointerType === "touch";
      }}
      onClick={(event) => {
        if (!tapping.current) return;
        tapping.current = false;
        const target = event.target as HTMLElement;
        if (target.closest("a, button, input, label, select, textarea, [role=button]")) return;
        hoverBlock(event);
      }}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest(".ProseMirror")) selectingRef.current = true;
      }}
      onMouseLeave={() => {
        if (!blockMenu && draggedBlock.current === null) setHover(null);
      }}
      onDragOver={(event) => {
        const from = draggedBlock.current;
        if (from === null || !editor) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        // Drop above or below the block under the pointer, whichever half it is in.
        const block = blockAtY(editor, event.clientY, Infinity);
        const wrapper = wrapperRef.current?.getBoundingClientRect();
        if (!block || !wrapper) return;
        const above = event.clientY < block.rect.top + block.rect.height / 2;
        const boundary = above ? block.pos : block.pos + block.node.nodeSize;
        const size = editor.state.doc.nodeAt(from)?.nodeSize ?? 0;
        const noMove = boundary >= from && boundary <= from + size;
        dropTarget.current = noMove ? null : boundary;
        const line = noMove ? null : (above ? block.rect.top : block.rect.bottom) - wrapper.top;
        setDropLine((current) => (current === line ? current : line));
      }}
      onDrop={(event) => {
        const from = draggedBlock.current;
        if (from === null || !editor) return;
        event.preventDefault();
        if (dropTarget.current !== null) moveBlock(from, dropTarget.current);
        endBlockDrag();
        setHover(null);
      }}
    >
      <div className={`editor-mode-bar ${showModeSwitch ? "" : "is-compact"}`}>
        {showModeSwitch ? (
          <div className="editor-mode-options" role="group" aria-label="Editor mode">
            <button
              className={mode === "interactive" ? "is-active" : ""}
              aria-pressed={mode === "interactive"}
              title="Edit with blocks and formatting"
              onClick={() => {
                if (editSource) onEditSourceChange?.(false);
                switchMode("interactive");
              }}
            >
              Interactive
            </button>
            <button
              className={mode === "markdown" ? "is-active" : ""}
              aria-pressed={mode === "markdown"}
              title="Edit the Markdown source"
              onClick={() => switchMode("markdown")}
            >
              <Code2 size={14} />
              Markdown
            </button>
          </div>
        ) : null}
        <div className="editor-history">
          <button
            title={shortcut.withKeys("Undo", "Mod+Z")}
            aria-label="Undo"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runHistory("undo")}
            disabled={mode === "markdown" ? !sourceHistory.undo : !editor?.can().undo()}
          >
            <Undo2 size={16} />
          </button>
          <button
            title={shortcut.withKeys("Redo", "Shift+Mod+Z")}
            aria-label="Redo"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runHistory("redo")}
            disabled={mode === "markdown" ? !sourceHistory.redo : !editor?.can().redo()}
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>
      {mode === "interactive" ? (
        <EmbedContext.Provider value={{ renderDatabase, onOpenPage, resolvePage, listDatabases }}>
          <EditorContent editor={editor} />
          <KeyboardToolbar editor={editor} />
        </EmbedContext.Provider>
      ) : (
        <>
          {editSource && (
            <div className="source-warning" role="note">
              <AlertTriangle size={16} />
              <span>
                You&apos;re editing this playbook&apos;s source. Steps and inputs are stored as data here — a small slip
                can break them, so it&apos;s safer to edit them on the page.
              </span>
              <button
                onClick={() => {
                  onEditSourceChange?.(false);
                  switchMode("interactive");
                }}
              >
                Back to the page
              </button>
            </div>
          )}
          <div className="md-editor">
            <div className="md-toolbar" role="toolbar" aria-label="Markdown formatting">
              <div className="md-tools">
                {MARKDOWN_TOOLS.map((group, index) => (
                  <span className="md-tool-group" key={index}>
                    {group.map((tool) => (
                      <button
                        key={tool.action}
                        type="button"
                        aria-label={tool.label}
                        title={tool.keys ? shortcut.withKeys(tool.label, tool.keys) : tool.label}
                        // Keep the editor's selection while clicking the toolbar.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          if (sourceEditorRef.current) applyMarkdown(sourceEditorRef.current, tool.action);
                        }}
                      >
                        <tool.icon size={16} />
                      </button>
                    ))}
                  </span>
                ))}
              </div>
            </div>
            <div className="markdown-source-editor" ref={sourceHostRef} aria-label="Markdown source editor" />
            <div className="md-status">
              <span>
                {sourceStats.lines} {sourceStats.lines === 1 ? "line" : "lines"}
                <span aria-hidden> · </span>
                {sourceStats.words} {sourceStats.words === 1 ? "word" : "words"}
              </span>
              <span className="md-supported">
                <MarkdownMark />
                Markdown is supported
              </span>
            </div>
          </div>
        </>
      )}
      {mode === "interactive" && hover && (blockMenu || draggingBlock) && (
        <div className="block-target" style={{ top: hover.box.top, height: hover.box.height }} aria-hidden />
      )}
      {dropLine !== null && <div className="block-drop-line" style={{ top: dropLine - 1 }} aria-hidden />}
      {mode === "interactive" && hover && (
        <div
          className="block-controls"
          style={{ top: hover.top }}
          // Keep the text cursor where it is when clicking "+". Not on the drag handle:
          // cancelling its mousedown would cancel the drag before it starts.
          onMouseDown={(event) => {
            if (!(event.target as HTMLElement).closest("[draggable='true']")) event.preventDefault();
          }}
        >
          <button
            title="Click to add below · Alt-click to add above"
            aria-label="Add a block below"
            onClick={(event) => addBlock(event.altKey)}
          >
            <Plus size={16} />
          </button>
          {/* A div, not a <button>: some browsers (Firefox) never start a drag from a button. */}
          <div
            role="button"
            tabIndex={0}
            title="Drag to move · Click for options"
            aria-label="Block actions"
            aria-expanded={blockMenu}
            className={`block-grip ${blockMenu ? "is-open" : ""}`}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (blockMenu) setBlockMenu(false);
              else openBlockMenu();
            }}
            draggable
            onDragStart={(event) => {
              draggedBlock.current = hover.position;
              setDraggingBlock(true);
              setBlockMenu(false);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-slate-block", String(hover.position));
              // Drag a picture of the block itself, not the tiny handle.
              if (hoverElement.current) event.dataTransfer.setDragImage(hoverElement.current, 16, 12);
            }}
            onDragEnd={endBlockDrag}
            onClick={() => (blockMenu ? setBlockMenu(false) : openBlockMenu())}
          >
            <GripVertical size={16} />
          </div>
        </div>
      )}
      {blockMenu &&
        hover &&
        (() => {
          const node = editor?.state.doc.nodeAt(hover.position);
          const canTurn = !!node?.isTextblock;
          const current =
            node?.type.name === "heading"
              ? `heading${node.attrs.level}`
              : node?.type.name === "codeBlock"
                ? "code"
                : node?.type.name === "paragraph"
                  ? "text"
                  : "";
          const turnInto: { name: string; action: BlockActionName; icon: typeof FileText }[] = [
            { name: "Text", action: "text", icon: FileText },
            { name: "Heading 1", action: "heading1", icon: Heading1 },
            { name: "Heading 2", action: "heading2", icon: Heading2 },
            { name: "Heading 3", action: "heading3", icon: Heading3 },
            { name: "Bulleted list", action: "bullet", icon: List },
            { name: "Numbered list", action: "numbered", icon: ListOrdered },
            { name: "To-do list", action: "todo", icon: CheckSquare },
            { name: "Quote", action: "quote", icon: Quote },
            { name: "Code", action: "code", icon: Code2 },
          ];
          const actions: { name: string; action: BlockActionName; icon: typeof FileText; keys?: string }[] = [
            { name: "Duplicate", action: "duplicate", icon: Copy, keys: "Mod+D" },
            { name: "Copy as Markdown", action: "copy", icon: ClipboardCopy },
            { name: "Copy link to block", action: "link", icon: Link2 },
            { name: "Move up", action: "up", icon: ArrowUp, keys: "Shift+Mod+ArrowUp" },
            { name: "Move down", action: "down", icon: ArrowDown, keys: "Shift+Mod+ArrowDown" },
          ];
          const close = () => {
            setBlockMenu(false);
            // Back to writing, except on a phone, where that would raise the keyboard.
            if (!isTouchOnly()) editor?.view.focus();
          };
          return (
            <>
              <button className="editor-menu-scrim" aria-label="Close block options" onClick={close} />
              <div
                className="editor-context-menu block-menu"
                role="menu"
                aria-label="Block options"
                ref={blockMenuRef}
                style={{ ...menuPlacement, left: "var(--editor-gutter)" }}
                onKeyDown={(event) => {
                  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"));
                  const index = items.indexOf(document.activeElement as HTMLElement);
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    items[(index + step + items.length) % items.length]?.focus();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                  }
                }}
              >
                {/* Only text-like blocks can change type; for others (databases, lists,
                  images…) the section would be all disabled rows, so it's left out. */}
                {canTurn && (
                  <>
                    <div className="editor-menu-label">Turn into</div>
                    {turnInto.map((item) => (
                      <button role="menuitem" key={item.action} onClick={() => void blockAction(item.action)}>
                        <item.icon size={16} />
                        <span>{item.name}</span>
                        {current === item.action && <Check size={14} className="menu-check" />}
                      </button>
                    ))}
                    <div className="editor-menu-divider" />
                  </>
                )}
                {node?.type.name === "taskList" && onMakeChecklist && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        // Each to-do (its first line) becomes a step; the list itself stays.
                        const items: string[] = [];
                        node.forEach((item) => {
                          const text = (item.firstChild?.textContent || "").trim();
                          if (text) items.push(text);
                        });
                        const pageId = onMakeChecklist(items);
                        setBlockMenu(false);
                        if (pageId && editor)
                          editor
                            .chain()
                            .focus()
                            .insertContentAt(hover.position + node.nodeSize, {
                              type: "workspaceEmbed",
                              attrs: { kind: "page", id: pageId },
                            })
                            .run();
                      }}
                    >
                      <ListChecks size={16} />
                      <span>Make a runnable checklist</span>
                    </button>
                    <div className="editor-menu-divider" />
                  </>
                )}
                {actions.map((item) => (
                  <button role="menuitem" key={item.action} onClick={() => void blockAction(item.action)}>
                    <item.icon size={16} />
                    <span>{item.name}</span>
                    {item.keys && <kbd>{shortcut.keys(item.keys)}</kbd>}
                  </button>
                ))}
                <div className="editor-menu-divider" />
                <button role="menuitem" className="danger" onClick={() => void blockAction("delete")}>
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </div>
            </>
          );
        })()}
      {bubble && mode === "interactive" && (
        <div className="editor-bubble" style={bubble} onMouseDown={(event) => event.preventDefault()}>
          {[
            [
              {
                name: "Heading 1",
                icon: Heading1,
                active: editor?.isActive("heading", { level: 1 }),
                run: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
              },
              {
                name: "Heading 2",
                icon: Heading2,
                active: editor?.isActive("heading", { level: 2 }),
                run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
              },
              {
                name: "Heading 3",
                icon: Heading3,
                active: editor?.isActive("heading", { level: 3 }),
                run: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
              },
            ],
            [
              {
                name: shortcut.withKeys("Bold", "Mod+B"),
                icon: Bold,
                active: editor?.isActive("bold"),
                run: () => editor?.chain().focus().toggleBold().run(),
              },
              {
                name: shortcut.withKeys("Italic", "Mod+I"),
                icon: Italic,
                active: editor?.isActive("italic"),
                run: () => editor?.chain().focus().toggleItalic().run(),
              },
              {
                name: "Strikethrough",
                icon: Strikethrough,
                active: editor?.isActive("strike"),
                run: () => editor?.chain().focus().toggleStrike().run(),
              },
              {
                name: shortcut.withKeys("Inline code", "Mod+E"),
                icon: Code,
                active: editor?.isActive("code"),
                run: () => editor?.chain().focus().toggleCode().run(),
              },
            ],
            [
              { name: shortcut.withKeys("Link", "Mod+K"), icon: Link2, active: editor?.isActive("link"), run: setLink },
              {
                name: "Quote",
                icon: Quote,
                active: editor?.isActive("blockquote"),
                run: () => editor?.chain().focus().toggleBlockquote().run(),
              },
            ],
          ].map((group, index) => (
            <span className="editor-bubble-group" key={index}>
              {group.map((item) => (
                <button
                  key={item.name}
                  title={item.name}
                  aria-label={item.name.replace(/ \(.*\)$/, "")}
                  aria-pressed={!!item.active}
                  className={item.active ? "is-active" : ""}
                  onClick={item.run}
                >
                  <item.icon size={16} />
                </button>
              ))}
            </span>
          ))}
        </div>
      )}
      {slash && mode === "interactive" && (
        <div
          id="slash-command-menu"
          className="slash-command-menu"
          role="listbox"
          aria-label="Insert a block"
          style={{ top: slash.top, bottom: slash.bottom, left: slash.left }}
        >
          {slash.query && filteredItems.length > 0 && <div className="editor-menu-label">Results</div>}
          {filteredItems.length ? (
            filteredItems.map((item, index) => [
              !slash.query && item.group !== filteredItems[index - 1]?.group && (
                <div className="editor-menu-label" key={`label-${item.group}`}>
                  {item.group}
                </div>
              ),
              <button
                key={item.name}
                id={`slash-option-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === slashIndex}
                className={index === slashIndex ? "is-selected" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runSlash(item);
                }}
                // mousemove, not mouseenter: when the arrow keys scroll the list, an
                // option sliding under a still pointer must not steal the highlight.
                onMouseMove={() => {
                  if (index !== slashIndex) setSlashIndex(index);
                }}
              >
                <span className="slash-item-icon">
                  <item.icon size={20} />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
              </button>,
            ])
          ) : (
            <div className="editor-no-results">No blocks match “{slash.query}”. Press space to keep typing.</div>
          )}
          <div className="slash-menu-footer">
            <span>{runnable && !slash.query ? "Type to search all blocks" : "↑↓ to navigate"}</span>
            <span>↵ to insert</span>
          </div>
        </div>
      )}
      {dbPicker && editor && (
        <DatabasePicker
          databases={dbPicker.databases}
          position={dbPicker.position}
          onClose={() => {
            setDbPicker(null);
            editor.commands.focus();
          }}
          onPick={(id) => {
            setDbPicker(null);
            // A linked block gets its own id, and with it its own views.
            const block = onLinkDatabase?.(id);
            editor
              .chain()
              .focus()
              .insertContent([
                { type: "workspaceEmbed", attrs: { kind: "database", id, ...(block ? { block } : {}) } },
                { type: "paragraph" },
              ])
              .run();
          }}
          onCreate={() => {
            setDbPicker(null);
            const id = onCreateDatabase?.();
            if (id)
              editor
                .chain()
                .focus()
                .insertContent([{ type: "workspaceEmbed", attrs: { kind: "database", id } }, { type: "paragraph" }])
                .run();
          }}
        />
      )}
      {urlInput && (
        <EditorUrlPopover
          key={urlInput.kind}
          kind={urlInput.kind}
          value={urlInput.value}
          onChange={(value) => setUrlInput({ ...urlInput, value })}
          onClose={() => setUrlInput(null)}
          onSubmit={submitUrl}
          onUploadImage={onUploadImage}
          position={urlInput.position}
        />
      )}
    </div>
  );
}

export default DocumentEditor;
