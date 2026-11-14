"use client";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Node,
  mergeAttributes,
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
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import {
  Database,
  ChevronRight,
  Info,
  Code2,
  Copy,
  Check,
} from "lucide-react";
import { encodeDirective, fencedCode, splitMarkdown } from "../../lib/markdown";
import { PageIcon } from "../page-icon";

import { EmbedContext, type EmbedOptions } from "./embed-context";
import { ProcedureParams, ProcedureSections, ProcedureStep, ValueRef, chipsFromText } from "./procedure-nodes";
export { EmbedContext, type EmbedOptions };
function EmbedView({ node, extension }: NodeViewProps) {
  const context = useContext(EmbedContext);
  const options =
    context.renderDatabase || context.onOpenPage
      ? context
      : (extension.options as EmbedOptions);
  if (node.attrs.kind === "database")
    return (
      <NodeViewWrapper
        className="document-database-embed"
        contentEditable={false}
      >
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
function PageReferenceButton({
  onOpen,
  title,
  children,
}: {
  onOpen: () => void;
  title: string;
  children: ReactNode;
}) {
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
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-workspace-embed": "" }),
    ];
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
        return (
          !dragging &&
          !!target &&
          ["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(target.tagName)
        );
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
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-preserved-source": "" }),
    ];
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
            onChange={(event) =>
              updateAttributes({ title: event.target.value })
            }
          />
        </div>
      ) : (
        <Info size={18} className="callout-icon" />
      )}
      <NodeViewContent
        className={
          toggle && !node.attrs.open
            ? "toggle-content is-closed"
            : "toggle-content"
        }
      />
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
  renderMarkdown(node) {
    return `:::slate-node ${JSON.stringify(node)}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ContainerView);
  },
});
function CodeView({ node, updateAttributes }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  return (
    <NodeViewWrapper className="editor-code-block">
      <div className="code-block-bar" contentEditable={false}>
        <select
          aria-label="Code language"
          value={String(node.attrs.language || "")}
          onChange={(event) =>
            updateAttributes({ language: event.target.value || null })
          }
        >
          {[
            ["", "Plain text"],
            ["typescript", "TypeScript"],
            ["javascript", "JavaScript"],
            ["python", "Python"],
            ["sql", "SQL"],
            ["json", "JSON"],
            ["css", "CSS"],
            ["html", "HTML"],
            ["bash", "Shell"],
            ["markdown", "Markdown"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
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
      <pre>
        <NodeViewContent as="div" className="code-content" />
      </pre>
    </NodeViewWrapper>
  );
}
const HighlightCode = CodeBlockLowlight.extend({
  addInputRules() {
    return [
      ...(this.parent?.() || []),
      textblockTypeInputRule({ find: /^```$/, type: this.type }),
    ];
  },
  renderMarkdown(node) {
    return fencedCode(
      (node.content || []).map((part) => part.text || "").join(""),
      String(node.attrs?.language || ""),
    );
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeView);
  },
}).configure({ lowlight: createLowlight(common) });

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
    TaskItem.configure({ nested: true }),
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
  ];
}

export function parseDocument(
  editor: Pick<Editor, "schema" | "markdown">,
  source: string,
): JSONContent {
  const content: JSONContent[] = [];
  const parts = splitMarkdown(source);
  for (const [index, part] of parts.entries()) {
    if (part.kind === "embed")
      content.push({ type: "workspaceEmbed", attrs: part.directive });
    else if (part.kind === "preserved")
      content.push({ type: "preservedSource", attrs: { source: part.source } });
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
      const text =
        index < parts.length - 1 ? part.source.replace(/\n\s*$/, "") : part.source;
      content.push(...(editor.markdown?.parse(text).content || []));
    }
  }
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
}
