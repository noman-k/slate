"use client";
/**
 * Editor blocks that make a page runnable: a Parameters block (the run's typed inputs)
 * and step blocks (Send, Ask, Check, If / Else, End). Each is saved as a `:::slate-node`
 * line, like callouts and toggles, and read back by `parseProcedure` to run the page.
 */
import { useContext, useEffect, useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import {
  END,
  OP_LABELS,
  STEP_LABELS,
  type ConditionOp,
  type Param,
  type ParamType,
  type StepType,
} from "../../lib/runner";
import { EmbedContext } from "./embed-context";
import { HTTP_METHODS } from "../../lib/api-request";

const STEP_HINTS: Record<StepType, string> = {
  send: "What to say or do — use {{name}} to fill in a value",
  ask: "The question to ask",
  check: "What to do and check",
  if: "Optional note on this decision",
  api: "What this request does, e.g. Look up the order",
  end: "Closing note (optional)",
};

/** Section titles (headings) and variable names in the document, kept up to date. */
function useDocumentInfo(editor: Editor) {
  const read = () => {
    const sections: string[] = [];
    const variables: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading" && node.attrs.level <= 2 && node.textContent.trim())
        sections.push(node.textContent.trim());
      if (node.type.name === "procedureParams")
        for (const param of (node.attrs.params as Param[]) || [])
          if (param.name && !variables.includes(param.name)) variables.push(param.name);
      if (node.type.name === "procedureStep" && node.attrs.step === "ask" && node.attrs.variable)
        if (!variables.includes(node.attrs.variable)) variables.push(node.attrs.variable);
      if (node.type.name === "procedureStep" && node.attrs.step === "api" && node.attrs.variable)
        for (const name of [node.attrs.variable, `${node.attrs.variable}_status`])
          if (!variables.includes(name)) variables.push(name);
      return node.type.name !== "procedureStep";
    });
    return { sections, variables };
  };
  const [info, setInfo] = useState(read);
  useEffect(() => {
    const update = () => setInfo(read());
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  return info;
}

/** A variable name people can type into {{…}}: letters, digits and underscores. */
const cleanName = (value: string) => value.replace(/\s+/g, "_").replace(/[^\w]/g, "");
/** A variable to check, which may read a field of a response: "order.status". */
const cleanPath = (value: string) => value.replace(/\s+/g, "_").replace(/[^\w.]/g, "");

function TargetSelect({
  label,
  value,
  sections,
  onChange,
}: {
  label: string;
  value: string;
  sections: string[];
  onChange: (value: string) => void;
}) {
  const missing = value && value !== END && !sections.includes(value);
  return (
    <select
      aria-label={label}
      className={missing ? "is-missing" : ""}
      title={missing ? `There's no “${value}” section any more` : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Next step</option>
      {sections.map((section) => (
        <option key={section} value={section}>
          Go to {section}
        </option>
      ))}
      {missing && <option value={value}>Go to {value} (missing)</option>}
      <option value={END}>End the run</option>
    </select>
  );
}

function StepView({ node, updateAttributes, editor }: NodeViewProps) {
  const step = (node.attrs.step as StepType) || "send";
  const { sections, variables } = useDocumentInfo(editor);
  const listId = `vars-${node.attrs.variable || "x"}-${step}`;
  const set = (attrs: Record<string, unknown>) => updateAttributes(attrs);
  const op = (node.attrs.op as ConditionOp) || "is";
  return (
    <NodeViewWrapper className={`proc-step is-${step}`}>
      <div className="proc-step-row">
        <span className="proc-step-badge" contentEditable={false}>
          <select
            aria-label="Step type"
            value={step}
            onChange={(event) => set({ step: event.target.value })}
          >
            {(Object.keys(STEP_LABELS) as StepType[]).map((type) => (
              <option key={type} value={type}>
                {STEP_LABELS[type]}
              </option>
            ))}
          </select>
        </span>
        {/* The hint lives inside the text area (the editor's own placeholder would be
            drawn on the whole block, over the badge). */}
        <div className="proc-step-body">
          {node.content.size === 0 && (
            <span className="proc-step-placeholder" contentEditable={false} aria-hidden>
              {STEP_HINTS[step]}
            </span>
          )}
          <NodeViewContent className="proc-step-text" />
        </div>
      </div>
      {step !== "send" && step !== "end" && (
        <div className="proc-step-config" contentEditable={false}>
          <datalist id={listId}>
            {variables.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {step === "ask" && (
            <>
              <label>
                Save answer as
                <input
                  className="proc-var-input"
                  aria-label="Save answer as"
                  placeholder="answer"
                  value={String(node.attrs.variable || "")}
                  onChange={(event) => set({ variable: cleanName(event.target.value) })}
                />
              </label>
              <select
                aria-label="Answer type"
                value={String(node.attrs.answer || "text")}
                onChange={(event) => set({ answer: event.target.value })}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="yesno">Yes / No</option>
                <option value="choice">Choice</option>
              </select>
              {node.attrs.answer === "choice" && (
                <input
                  aria-label="Choices"
                  placeholder="Choices, comma-separated"
                  value={String(node.attrs.options || "")}
                  onChange={(event) => set({ options: event.target.value })}
                />
              )}
            </>
          )}
          {step === "check" && (
            <>
              <label className="proc-grow">
                Expect
                <input
                  aria-label="Expected result"
                  placeholder="What you should see when it worked"
                  value={String(node.attrs.expected || "")}
                  onChange={(event) => set({ expected: event.target.value })}
                />
              </label>
              <label>
                If it fails
                <TargetSelect
                  label="If it fails"
                  value={String(node.attrs.else || "")}
                  sections={sections}
                  onChange={(value) => set({ else: value })}
                />
              </label>
            </>
          )}
          {step === "api" && (
            <>
              <span className="proc-config-line">
                <select
                  className="proc-method"
                  aria-label="Method"
                  value={String(node.attrs.method || "GET")}
                  onChange={(event) => set({ method: event.target.value })}
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
                <input
                  className="proc-url"
                  aria-label="URL"
                  placeholder="https://api.example.com/orders/{{order_number}}"
                  spellCheck={false}
                  value={String(node.attrs.url || "")}
                  onChange={(event) => set({ url: event.target.value })}
                />
              </span>
              <span className="proc-config-line">
                <label>
                  Save response as
                  <input
                    className="proc-var-input"
                    aria-label="Save response as"
                    placeholder="response"
                    value={String(node.attrs.variable || "")}
                    onChange={(event) => set({ variable: cleanName(event.target.value) })}
                  />
                </label>
                <label>
                  If it fails
                  <TargetSelect
                    label="If the request fails"
                    value={String(node.attrs.else || "")}
                    sections={sections}
                    onChange={(value) => set({ else: value })}
                  />
                </label>
              </span>
              <details className="proc-request-more" open={!!(node.attrs.headers || node.attrs.body) || undefined}>
                <summary>Headers and body</summary>
                <label className="proc-block-field">
                  <span>Headers — one per line</span>
                  <textarea
                    aria-label="Headers"
                    rows={2}
                    spellCheck={false}
                    placeholder={"Authorization: Bearer your-token\nAccept: application/json"}
                    value={String(node.attrs.headers || "")}
                    onChange={(event) => set({ headers: event.target.value })}
                  />
                </label>
                {node.attrs.method && node.attrs.method !== "GET" && (
                  <label className="proc-block-field">
                    <span>Body — JSON or text, with {"{{values}}"}</span>
                    <textarea
                      aria-label="Body"
                      rows={3}
                      spellCheck={false}
                      placeholder={'{ "order": "{{order_number}}" }'}
                      value={String(node.attrs.body || "")}
                      onChange={(event) => set({ body: event.target.value })}
                    />
                  </label>
                )}
                <small className="proc-warning">
                  Headers are saved in this page: anyone who can open it can see them.
                </small>
              </details>
            </>
          )}
          {step === "if" && (
            <>
              <span className="proc-config-line">
                <span className="proc-config-word">When</span>
                <input
                  className="proc-var-input"
                  aria-label="Variable to check"
                  placeholder="variable"
                  list={listId}
                  value={String(node.attrs.variable || "")}
                  onChange={(event) => set({ variable: cleanPath(event.target.value) })}
                />
                <select
                  aria-label="Condition"
                  value={op}
                  onChange={(event) => set({ op: event.target.value })}
                >
                  {(Object.keys(OP_LABELS) as ConditionOp[]).map((key) => (
                    <option key={key} value={key}>
                      {OP_LABELS[key]}
                    </option>
                  ))}
                </select>
                {op !== "set" && op !== "not_set" && (
                  <input
                    aria-label="Value to compare"
                    placeholder="value"
                    value={String(node.attrs.value || "")}
                    onChange={(event) => set({ value: event.target.value })}
                  />
                )}
              </span>
              <span className="proc-config-line">
                <label>
                  <span className="proc-config-word">then</span>
                  <TargetSelect
                    label="Then"
                    value={String(node.attrs.then || "")}
                    sections={sections}
                    onChange={(value) => set({ then: value })}
                  />
                </label>
                <label>
                  <span className="proc-config-word">otherwise</span>
                  <TargetSelect
                    label="Else"
                    value={String(node.attrs.else || "")}
                    sections={sections}
                    onChange={(value) => set({ else: value })}
                  />
                </label>
              </span>
            </>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** Lets inputs inside a block take their own keys and clicks. */
const stopFormEvents = ({ event }: { event: Event }) => {
  const target = event.target as HTMLElement | null;
  const dragging = event.type.startsWith("drag") || event.type === "drop";
  return (
    !dragging &&
    !!target &&
    ["INPUT", "BUTTON", "SELECT", "TEXTAREA", "OPTION"].includes(target.tagName)
  );
};

export const ProcedureStep = Node.create({
  name: "procedureStep",
  group: "block",
  content: "inline*",
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      step: { default: "send" },
      variable: { default: null },
      answer: { default: null },
      options: { default: null },
      expected: { default: null },
      op: { default: null },
      value: { default: null },
      then: { default: null },
      else: { default: null },
      method: { default: null },
      url: { default: null },
      headers: { default: null },
      body: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-procedure-step]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-procedure-step": "" }), 0];
  },
  renderMarkdown(node) {
    // Only the settings in use, so the saved line stays short.
    const attrs = Object.fromEntries(
      Object.entries(node.attrs || {}).filter(([, value]) => value !== null && value !== ""),
    );
    return `:::slate-node ${JSON.stringify({ ...node, attrs })}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(StepView, { stopEvent: stopFormEvents });
  },
});

const PARAM_TYPES: { value: ParamType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes / No" },
  { value: "choice", label: "Choice" },
  { value: "record", label: "Database record" },
];

function ParamsView({ node, updateAttributes }: NodeViewProps) {
  const params = (node.attrs.params as Param[]) || [];
  const { listDatabases } = useContext(EmbedContext);
  const databases = listDatabases?.() ?? [];
  const save = (next: Param[]) => updateAttributes({ params: next });
  const edit = (index: number, patch: Partial<Param>) =>
    save(params.map((param, i) => (i === index ? { ...param, ...patch } : param)));
  return (
    <NodeViewWrapper className="proc-params" contentEditable={false}>
      <div className="proc-params-head">
        <SlidersHorizontal size={15} />
        <strong>Parameters</strong>
        <span>Asked for when this runs · use {"{{name}}"} in steps</span>
      </div>
      {params.length > 0 && (
        <div className="proc-params-table" role="table" aria-label="Parameters">
          <div className="proc-params-row is-head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Default or options</span>
            <span role="columnheader">Required</span>
            <span aria-hidden />
          </div>
          {params.map((param, index) => (
            <div className="proc-params-row" role="row" key={index}>
              <input
                className="proc-var-input"
                aria-label="Parameter name"
                placeholder="name"
                value={param.name}
                onChange={(event) => edit(index, { name: cleanName(event.target.value) })}
              />
              <select
                aria-label={`Type of ${param.name || "parameter"}`}
                value={param.type}
                onChange={(event) => edit(index, { type: event.target.value as ParamType })}
              >
                {PARAM_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              {param.type === "record" ? (
                <select
                  aria-label={`Database for ${param.name || "parameter"}`}
                  value={param.databaseId || ""}
                  onChange={(event) => edit(index, { databaseId: event.target.value })}
                >
                  <option value="">Choose a database…</option>
                  {databases.map((db) => (
                    <option key={db.id} value={db.id}>
                      {db.name || "Untitled"}
                    </option>
                  ))}
                </select>
              ) : param.type === "choice" ? (
                <input
                  aria-label={`Choices for ${param.name || "parameter"}`}
                  placeholder="Choices, comma-separated"
                  value={(param.options || []).join(", ")}
                  onChange={(event) =>
                    edit(index, {
                      options: event.target.value.split(",").map((o) => o.trimStart()),
                    })
                  }
                />
              ) : (
                <input
                  aria-label={`Default for ${param.name || "parameter"}`}
                  placeholder="No default"
                  type={param.type === "date" ? "date" : param.type === "number" ? "number" : "text"}
                  value={param.default || ""}
                  onChange={(event) => edit(index, { default: event.target.value })}
                />
              )}
              <label className="proc-required">
                <input
                  type="checkbox"
                  aria-label={`${param.name || "Parameter"} is required`}
                  checked={param.required}
                  onChange={(event) => edit(index, { required: event.target.checked })}
                />
              </label>
              <button
                className="proc-remove"
                aria-label={`Remove ${param.name || "parameter"}`}
                title="Remove"
                onClick={() => save(params.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        className="proc-add"
        onClick={() => save([...params, { name: "", type: "text", required: true }])}
      >
        <Plus size={14} />
        Add parameter
      </button>
    </NodeViewWrapper>
  );
}

export const ProcedureParams = Node.create({
  name: "procedureParams",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { params: { default: [] } };
  },
  parseHTML() {
    return [{ tag: "div[data-procedure-params]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-procedure-params": "" })];
  },
  renderMarkdown(node) {
    return `:::slate-node ${JSON.stringify(node)}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ParamsView, { stopEvent: stopFormEvents });
  },
});

/** Shows {{name}} references in the text as chips, so they read as values to fill in. */
export const VariableChips = Extension.create({
  name: "variableChips",
  addProseMirrorPlugins() {
    const build = (doc: PMNode) => {
      const decorations: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        for (const match of node.text.matchAll(/\{\{\s*[A-Za-z_][\w]*(?:\.[^}]+?)?\s*\}\}/g))
          decorations.push(
            Decoration.inline(pos + match.index!, pos + match.index! + match[0].length, {
              class: "var-chip",
            }),
          );
      });
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin({
        key: new PluginKey("variableChips"),
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export interface SectionStorage {
  /** Starts a run at this section (set by the page editor). */
  onRunFrom: ((section: string) => void) | null;
  /** Sections whose steps are folded away (for this session). */
  collapsed: Set<string>;
}
const sectionsKey = new PluginKey<DecorationSet>("procedureSections");
/** Turns "Run from here" on section headings on or off, and redraws them. */
export function setRunFrom(editor: Editor, run: ((section: string) => void) | null) {
  const storage = (editor.storage as unknown as Record<string, SectionStorage>).procedureSections;
  if (!storage) return;
  storage.onRunFrom = run;
  editor.view.dispatch(editor.state.tr.setMeta(sectionsKey, "refresh"));
}

/** Top-level headings (H1/H2) and the step blocks that follow each one. */
function sectionsIn(doc: PMNode) {
  const sections: { pos: number; node: PMNode; title: string; steps: { pos: number; node: PMNode }[] }[] = [];
  let current: (typeof sections)[number] | null = null;
  doc.forEach((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level <= 2) {
      current = { pos, node, title: node.textContent.trim(), steps: [] };
      sections.push(current);
    } else if (node.type.name === "procedureStep" && current) current.steps.push({ pos, node });
  });
  return sections;
}

const icon = (path: string) =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

/** The chip after a section heading: "3 steps" (click to fold) and Run from here. */
function sectionTools(title: string, count: number, collapsed: boolean, storage: SectionStorage) {
  return (view: import("@tiptap/pm/view").EditorView) => {
    const tools = document.createElement("span");
    tools.className = "proc-section-tools";
    tools.contentEditable = "false";
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "proc-section-count";
    fold.setAttribute("aria-expanded", String(!collapsed));
    fold.setAttribute("aria-label", `${collapsed ? "Show" : "Hide"} the ${count} steps in ${title}`);
    fold.title = collapsed ? "Show these steps" : "Hide these steps";
    fold.innerHTML = `${icon(collapsed ? '<path d="m9 18 6-6-6-6"/>' : '<path d="m6 9 6 6 6-6"/>')}<span>${count} ${count === 1 ? "step" : "steps"}${collapsed ? " hidden" : ""}</span>`;
    fold.addEventListener("mousedown", (event) => event.preventDefault());
    fold.addEventListener("click", () => {
      if (storage.collapsed.has(title)) storage.collapsed.delete(title);
      else storage.collapsed.add(title);
      view.dispatch(view.state.tr.setMeta(sectionsKey, "refresh"));
    });
    tools.append(fold);
    if (storage.onRunFrom) {
      const run = document.createElement("button");
      run.type = "button";
      run.className = "proc-section-run";
      run.setAttribute("aria-label", `Run from ${title}`);
      run.title = "Start a run at this section";
      run.innerHTML = `${icon('<path d="M6 4v16l14-8z"/>')}<span>Run from here</span>`;
      run.addEventListener("mousedown", (event) => event.preventDefault());
      run.addEventListener("click", () => storage.onRunFrom?.(title));
      tools.append(run);
    }
    return tools;
  };
}

/**
 * Sections of a runnable page: a heading and the steps under it read as one group (a
 * step count on the heading, a rail beside its steps), can be folded or run from, and
 * steps that "go to" a section follow it when the heading is renamed.
 */
export const ProcedureSections = Extension.create<object, SectionStorage>({
  name: "procedureSections",
  addStorage() {
    return { onRunFrom: null, collapsed: new Set<string>() };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    const build = (doc: PMNode) => {
      const decorations: Decoration[] = [];
      for (const section of sectionsIn(doc)) {
        if (!section.steps.length || !section.title) continue;
        const collapsed = storage.collapsed.has(section.title);
        const end = section.pos + section.node.nodeSize;
        decorations.push(Decoration.node(section.pos, end, { class: "proc-section-heading" }));
        decorations.push(
          Decoration.widget(end - 1, sectionTools(section.title, section.steps.length, collapsed, storage), {
            side: 1,
            ignoreSelection: true,
            stopEvent: () => true,
            key: `section:${section.title}:${section.steps.length}:${collapsed}:${!!storage.onRunFrom}`,
          }),
        );
        section.steps.forEach(({ pos, node }, index) =>
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: [
                "proc-in-section",
                index === section.steps.length - 1 ? "is-last" : "",
                collapsed ? "proc-collapsed" : "",
              ]
                .filter(Boolean)
                .join(" "),
            }),
          ),
        );
      }
      return DecorationSet.create(doc, decorations);
    };
    return [
      new Plugin<DecorationSet>({
        key: sectionsKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(sectionsKey) ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return sectionsKey.getState(state);
          },
        },
        // A renamed section heading takes the steps that go to it along.
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const renames = new Map<string, string>();
          for (const section of sectionsIn(oldState.doc)) {
            if (!section.title) continue;
            let pos: number | null = section.pos;
            for (const tr of transactions) {
              if (pos === null) break;
              const mapped = tr.mapping.mapResult(pos, 1);
              pos = mapped.deleted ? null : mapped.pos;
            }
            const now = pos === null ? null : newState.doc.nodeAt(pos);
            const title = now?.type.name === "heading" ? now.textContent.trim() : "";
            if (title && title !== section.title) renames.set(section.title, title);
          }
          if (!renames.size) return null;
          // Only when the old name is gone (two headings could share it).
          const titles = new Set(sectionsIn(newState.doc).map((s) => s.title));
          let tr = newState.tr;
          newState.doc.forEach((node, pos) => {
            if (node.type.name !== "procedureStep") return;
            const attrs = { ...node.attrs };
            let changed = false;
            for (const key of ["then", "else"] as const) {
              const to = renames.get(attrs[key]);
              if (to && !titles.has(attrs[key])) {
                attrs[key] = to;
                changed = true;
              }
            }
            if (changed) tr = tr.setNodeMarkup(pos, undefined, attrs);
          });
          for (const [from, to] of renames)
            if (storage.collapsed.delete(from)) storage.collapsed.add(to);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
