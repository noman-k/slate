"use client";
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import {
  Extension,
  Node,
  mergeAttributes,
  textInputRule,
  textblockTypeInputRule,
  type Editor,
  type JSONContent,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Database, ChevronRight, Info, Code2, Copy, Check, ChevronsUpDown, Search } from "lucide-react";
import { encodeDirective, escapeSummary, fencedCode, splitMarkdown } from "../../lib/markdown";
import { PageIcon } from "../page-icon";

import { EmbedContext, type EmbedOptions } from "./embed-context";
import { ProcedureParams, ProcedureSections, ProcedureStep, ValueRef, chipsFromText } from "./procedure-nodes";
export { EmbedContext, type EmbedOptions };
function EmbedView({ node, extension }: NodeViewProps) {
  const context = useContext(EmbedContext);
  const options = context.renderDatabase || context.onOpenPage ? context : (extension.options as EmbedOptions);
  if (node.attrs.kind === "database")
    return (
      <NodeViewWrapper className="document-database-embed" contentEditable={false}>
        <EmbedSurface>
          {options.renderDatabase?.(String(node.attrs.id), node.attrs.block ? String(node.attrs.block) : undefined) ?? (
            <div className="editor-reference">
              <Database size={16} /> Database <span>{node.attrs.id}</span>
            </div>
          )}
        </EmbedSurface>
      </NodeViewWrapper>
    );
  const linked = options.resolvePage?.(String(node.attrs.id));
  // resolvePage skips trashed pages; their block stays (restoring brings it back).
  if (options.resolvePage && !linked)
    return (
      <NodeViewWrapper contentEditable={false}>
        <div className="editor-page-reference is-missing" title="This page is in the Trash">
          <PageIcon page={{ icon: "", kind: "document" }} size={18} />
          <span>{node.attrs.title || "Page"} is in the Trash</span>
        </div>
      </NodeViewWrapper>
    );
  const title = linked?.title || "";
  return (
    <NodeViewWrapper contentEditable={false}>
      <PageReferenceButton
        onOpen={() => options.onOpenPage?.(String(node.attrs.id))}
        title={`Open ${title || "Untitled"}`}
      >
        <PageIcon page={linked ?? { icon: "", kind: "document" }} size={18} />
        <span className={title ? "" : "is-untitled"}>{title || "Untitled"}</span>
        <ChevronRight size={16} />
      </PageReferenceButton>
    </NodeViewWrapper>
  );
}
/**
 * An embedded database is a working surface (cells, menus, buttons). Clicks inside
 * it are its own, so the editor doesn't select the whole block and ring it in blue.
 * Focus is left alone so its inputs still work.
 */
function EmbedSurface({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    const stop = (event: MouseEvent) => event.stopPropagation();
    surface.addEventListener("mousedown", stop);
    return () => surface.removeEventListener("mousedown", stop);
  }, []);
  return <div ref={ref}>{children}</div>;
}
/**
 * A page block opens its page on click. ProseMirror would otherwise treat a press on
 * the icon or title as "select this block" and flash the selection ring first, so the
 * press is stopped natively, before the editor's own listener sees it, and it doesn't
 * move focus into the editor. Keyboard and drag-handle selection still work.
 */
function PageReferenceButton({ onOpen, title, children }: { onOpen: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    const stop = (event: MouseEvent) => {
      event.stopPropagation();
      // Keep focus where it is: in Safari a click here would otherwise focus the
      // editor around it. The click (and keyboard focus) still work as normal.
      event.preventDefault();
    };
    button.addEventListener("mousedown", stop);
    return () => button.removeEventListener("mousedown", stop);
  }, []);
  return (
    <button ref={ref} className="editor-page-reference" onClick={onOpen} title={title}>
      {children}
    </button>
  );
}
/**
 * A to-do item whose checkbox toggles without moving focus into the text. Tiptap's own
 * focuses the editor on every toggle, which on a phone places the cursor and raises the
 * keyboard. Ticking something off isn't editing it.
 */
const TaskItemQuiet = TaskItem.extend({
  addNodeView() {
    const render = this.parent?.();
    if (!render) return null;
    return (props) => {
      const view = render(props);
      const item = view.dom as HTMLElement;
      const box = item.querySelector<HTMLInputElement>(':scope > label > input[type="checkbox"]');
      // Capture runs before Tiptap's listener on the checkbox, which this one replaces.
      item.addEventListener(
        "change",
        (event) => {
          if (!box || event.target !== box) return; // a nested item's checkbox
          event.stopPropagation();
          const { editor, getPos } = props;
          if (!editor.isEditable) {
            box.checked = !box.checked;
            return;
          }
          const position = typeof getPos === "function" ? getPos() : undefined;
          const node = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
          if (typeof position !== "number" || !node) return;
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: box.checked }),
          );
        },
        true,
      );
      return view;
    };
  },
});
const WorkspaceEmbed = Node.create<EmbedOptions>({
  name: "workspaceEmbed",
  group: "block",
  atom: true,
  draggable: true,
  // ProseMirror's drop cursor listens to the editor directly, so it would draw a
  // "drop text here" line while you drag rows inside an embedded database.
  extendNodeSchema(extension) {
    return extension.name === "workspaceEmbed"
      ? {
          disableDropCursor: (_view: unknown, _pos: unknown, event: DragEvent) =>
            !!(event.target as HTMLElement | null)?.closest?.(".database-view"),
        }
      : {};
  },
  addOptions() {
    return {};
  },
  addAttributes() {
    return {
      kind: { default: "database" },
      id: { default: "" },
      title: { default: "" },
      viewId: { default: null },
      block: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-workspace-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-workspace-embed": "" })];
  },
  renderMarkdown(node) {
    return encodeDirective({
      kind: node.attrs?.kind === "page" ? "page" : "database",
      id: String(node.attrs?.id || ""),
      ...(node.attrs?.title ? { title: String(node.attrs.title) } : {}),
      ...(node.attrs?.viewId ? { viewId: String(node.attrs.viewId) } : {}),
      ...(node.attrs?.block ? { block: String(node.attrs.block) } : {}),
    });
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView, {
      // An embedded database is its own app inside the page: the editor ignores
      // every event in it (clicks, typing in cells, dragging rows), so they never
      // become text selections, drop cursors or edits. Buttons and inputs elsewhere
      // in the block keep the usual behaviour.
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(".database-view")) return true;
        const dragging = event.type.startsWith("drag") || event.type === "drop";
        return !dragging && !!target && ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(target.tagName);
      },
    });
  },
});
function PreservedView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper contentEditable={false} className="preserved-source">
      <div>
        <Code2 size={14} /> Source block · preserved without changes
      </div>
      <pre>{String(node.attrs.source)}</pre>
      <small>Edit this block in Markdown mode.</small>
    </NodeViewWrapper>
  );
}
const PreservedSource = Node.create({
  name: "preservedSource",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-preserved-source]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-preserved-source": "" })];
  },
  renderMarkdown(node) {
    return String(node.attrs?.source || "");
  },
  addNodeView() {
    return ReactNodeViewRenderer(PreservedView);
  },
});
function ContainerView({ node, updateAttributes }: NodeViewProps) {
  const toggle = node.type.name === "toggle";
  return (
    <NodeViewWrapper className={toggle ? "editor-toggle" : "editor-callout"}>
      {toggle ? (
        <div className="editor-toggle-heading" contentEditable={false}>
          <button
            aria-label={node.attrs.open ? "Collapse toggle" : "Expand toggle"}
            onClick={() => updateAttributes({ open: !node.attrs.open })}
          >
            <ChevronRight
              size={16}
              style={{
                transform: node.attrs.open ? "rotate(90deg)" : undefined,
              }}
            />
          </button>
          <input
            aria-label="Toggle title"
            value={String(node.attrs.title)}
            onChange={(event) => updateAttributes({ title: event.target.value })}
          />
        </div>
      ) : (
        <Info size={18} className="callout-icon" />
      )}
      <NodeViewContent className={toggle && !node.attrs.open ? "toggle-content is-closed" : "toggle-content"} />
    </NodeViewWrapper>
  );
}
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  draggable: true,
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },
  renderMarkdown(node) {
    return `:::slate-node ${JSON.stringify(node)}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ContainerView);
  },
});
/**
 * A collapsible toggle. It's saved as HTML's own `<details>`, which Markdown allows, so it
 * reads well anywhere and agents and imports can write one (Notion's export uses it too):
 *
 *     <details open>
 *     <summary>Title</summary>
 *
 *     What's inside, as Markdown.
 *
 *     </details>
 *
 * Toggles saved before this (a `:::slate-node` line) still open.
 */
const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  draggable: true,
  addAttributes() {
    return { title: { default: "Toggle" }, open: { default: true } };
  },
  parseHTML() {
    return [{ tag: "div[data-toggle]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), 0];
  },
  renderMarkdown(node, h) {
    const body = (node.content || []).map((child: JSONContent) => h.renderChildren([child])).join("\n\n");
    const title = escapeSummary(String(node.attrs?.title ?? ""));
    return `<details${node.attrs?.open ? " open" : ""}>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ContainerView);
  },
});
/** Syntax highlighting: lowlight's common languages (highlight.js). */
const lowlight = createLowlight(common);
/**
 * Guessing a block's language (when none is chosen) only considers widely used ones:
 * across every grammar it often lands on a niche one (TypeScript read as Arduino) and
 * colors little. Applies to the highlighting and to the label alike.
 */
const AUTO_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "graphql",
  "xml",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "scss",
  "sql",
  "swift",
  "typescript",
  "yaml",
];
const highlightAll = lowlight.highlightAuto.bind(lowlight);
lowlight.highlightAuto = (value, options) => highlightAll(value, { subset: AUTO_LANGUAGES, ...options });

/** The languages a code block offers, by name. "" means detect it from the code. */
const CODE_LANGUAGES: [string, string][] = [
  ["", "Auto-detect"],
  ["plaintext", "Plain text"],
  ["bash", "Shell"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["diff", "Diff"],
  ["go", "Go"],
  ["graphql", "GraphQL"],
  ["xml", "HTML / XML"],
  ["ini", "INI / TOML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["kotlin", "Kotlin"],
  ["less", "Less"],
  ["lua", "Lua"],
  ["makefile", "Makefile"],
  ["markdown", "Markdown"],
  ["objectivec", "Objective-C"],
  ["perl", "Perl"],
  ["php", "PHP"],
  ["python", "Python"],
  ["r", "R"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["scss", "SCSS"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["typescript", "TypeScript"],
  ["vbnet", "VB.NET"],
  ["yaml", "YAML"],
];
/** Other names people write after ``` for the same languages. */
const CODE_ALIASES: Record<string, string> = {
  html: "xml",
  svg: "xml",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  yml: "yaml",
  md: "markdown",
  rb: "ruby",
  rs: "rust",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  toml: "ini",
  text: "plaintext",
  txt: "plaintext",
  kt: "kotlin",
  objc: "objectivec",
};
const canonicalLanguage = (language: string) => CODE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
const languageLabel = (language: string) =>
  CODE_LANGUAGES.find(([value]) => value === canonicalLanguage(language))?.[1] ?? language;

/**
 * A code block: the language (searchable; detected from the code unless chosen) and Copy
 * above the code. Tab indents inside it.
 */
function CodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const language = String(node.attrs.language || "");
  const text = node.textContent;
  // What auto-detect found (only shown, not saved: it follows the code as you type).
  const detected = useMemo(() => {
    if (language || !text.trim()) return "";
    const found = lowlight.highlightAuto(text.slice(0, 4000)).data?.language;
    return typeof found === "string" ? found : "";
  }, [language, text]);
  const term = query.trim().toLowerCase();
  const choices = CODE_LANGUAGES.filter(
    ([value, label]) =>
      !term ||
      label.toLowerCase().includes(term) ||
      value.includes(term) ||
      Object.entries(CODE_ALIASES).some(([alias, target]) => target === value && alias.startsWith(term)),
  );
  const choose = (value: string) => {
    updateAttributes({ language: value || null });
    setPicking(false);
    setQuery("");
    editor.commands.focus();
  };
  return (
    <NodeViewWrapper className="editor-code-block" data-language={language || detected || undefined}>
      <div className="code-block-bar" contentEditable={false}>
        {editor.isEditable ? (
          <Popover.Root
            open={picking}
            onOpenChange={(open) => {
              setPicking(open);
              if (!open) setQuery("");
            }}
          >
            <Popover.Trigger asChild>
              <button
                className="code-lang"
                aria-label={`Code language: ${language ? languageLabel(language) : "auto-detect"}`}
              >
                {language ? languageLabel(language) : detected ? languageLabel(detected) : "Auto-detect"}
                {!language && detected && <span className="code-lang-auto">auto</span>}
                <ChevronsUpDown size={12} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                className="menu-surface code-lang-menu"
                align="start"
                sideOffset={6}
                collisionPadding={12}
                aria-label="Code language"
              >
                <label className="code-lang-search">
                  <Search size={14} />
                  <input
                    autoFocus
                    placeholder="Search languages…"
                    aria-label="Search languages"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && choices[0]) {
                        event.preventDefault();
                        choose(choices[0][0]);
                      }
                    }}
                  />
                </label>
                <div className="code-lang-list" role="listbox" aria-label="Languages">
                  {choices.map(([value, label]) => {
                    const current = canonicalLanguage(language) === value;
                    return (
                      <button
                        key={value || "auto"}
                        role="option"
                        aria-selected={current}
                        className="menu-item"
                        onClick={() => choose(value)}
                      >
                        <span>{label}</span>
                        {value === "" && detected && <small>{languageLabel(detected)}</small>}
                        {current && <Check size={14} />}
                      </button>
                    );
                  })}
                  {!choices.length && <div className="menu-empty">No matching language</div>}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <span className="code-lang is-static">
            {language ? languageLabel(language) : detected ? languageLabel(detected) : "Code"}
          </span>
        )}
        <button
          className="code-copy"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={async () => {
            await navigator.clipboard.writeText(node.textContent);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent as="div" className="code-content" />
      </pre>
    </NodeViewWrapper>
  );
}
const HighlightCode = CodeBlockLowlight.extend({
  addInputRules() {
    return [...(this.parent?.() || []), textblockTypeInputRule({ find: /^```$/, type: this.type })];
  },
  renderMarkdown(node) {
    return fencedCode((node.content || []).map((part) => part.text || "").join(""), String(node.attrs?.language || ""));
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeView);
  },
}).configure({ lowlight, enableTabIndentation: true, tabSize: 2 });

/**
 * Two hyphens become an em dash as you type ("well--almost" → "well—almost"), as in Notion
 * and most writing apps, and arrows become arrows: "->" → "→", "<-" → "←", "<->" → "↔".
 * Backspace right after turns it back into what was typed. "---" at the start of a line
 * still makes a divider (its rule takes "—-" too); never in code.
 */
const SmartDash = Extension.create({
  name: "smartDash",
  addInputRules() {
    return [
      textInputRule({ find: /--$/, replace: "\u2014" }),
      textInputRule({ find: /->$/, replace: "\u2192" }),
      textInputRule({ find: /<-$/, replace: "\u2190" }),
      textInputRule({ find: /\u2190>$/, replace: "\u2194" }),
    ];
  },
});

export function createDocumentExtensions(options: EmbedOptions = {}) {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
      dropcursor: { color: "var(--accent)", width: 2 },
    }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    Placeholder.configure({
      includeChildren: true,
      // Context-specific wording (lists, quotes, empty page) lives in editor.css: the
      // placeholder callback runs mid-transaction, where positions can't be resolved safely.
      placeholder: ({ node }) =>
        node.type.name === "heading"
          ? `Heading ${node.attrs.level}`
          : node.type.name === "paragraph"
            ? "Press '/' for commands…"
            : "",
    }),
    TaskList,
    TaskItemQuiet.configure({ nested: true }),
    Image.configure({ allowBase64: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    HighlightCode,
    WorkspaceEmbed.configure(options),
    PreservedSource,
    Callout,
    Toggle,
    ProcedureParams,
    ProcedureStep,
    ValueRef,
    ProcedureSections,
    SmartDash,
  ];
}

export function parseDocument(editor: Pick<Editor, "schema" | "markdown">, source: string): JSONContent {
  const top: JSONContent[] = [];
  let content = top;
  /** Toggles being filled, outermost first (each `<details>` until its `</details>`). */
  const open: { node: JSONContent; parent: JSONContent[] }[] = [];
  const close = () => {
    const { node, parent } = open.pop()!;
    if (!node.content!.length) node.content!.push({ type: "paragraph" });
    parent.push(node);
    content = parent;
  };
  const parts = splitMarkdown(source);
  for (const [index, part] of parts.entries()) {
    if (part.kind === "toggle-start") {
      const node: JSONContent = { type: "toggle", attrs: { title: part.title, open: part.open }, content: [] };
      open.push({ node, parent: content });
      content = node.content!;
    } else if (part.kind === "toggle-end") {
      if (open.length) close();
    } else if (part.kind === "embed") content.push({ type: "workspaceEmbed", attrs: part.directive });
    else if (part.kind === "preserved") content.push({ type: "preservedSource", attrs: { source: part.source } });
    else if (part.kind === "rich") {
      try {
        // Steps keep values as {{key}} text; the editor shows them as chips.
        const node = editor.schema.nodeFromJSON(chipsFromText(part.node));
        node.check();
        content.push(node.toJSON() as JSONContent);
      } catch {
        content.push({
          type: "preservedSource",
          attrs: { source: part.source },
        });
      }
    } else if (part.source.trim()) {
      // Blank lines before a block line (a table's serializer adds one) would come
      // back as an empty paragraph, one more on every save.
      const text = index < parts.length - 1 ? part.source.replace(/\n\s*$/, "") : part.source;
      content.push(...(editor.markdown?.parse(text).content || []));
    }
  }
  while (open.length) close();
  return {
    type: "doc",
    content: top.length ? top : [{ type: "paragraph" }],
  };
}
