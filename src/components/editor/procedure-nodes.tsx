"use client";
/**
 * Editor blocks that make a page runnable: a Parameters block (the run's typed inputs)
 * and step blocks (Send, Ask, Check, If / Else, End). Each is saved as a `:::slate-node`
 * line, like callouts and toggles, and read back by `parseProcedure` to run the page.
 */
import { createContext, useContext, useEffect, useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Extension, InputRule, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Braces, Plus, SlidersHorizontal, X } from "lucide-react";
import {
  END,
  OP_LABELS,
  STEP_LABELS,
  humanize,
  keyFor,
  labelOf,
  valuesOf,
  type ConditionOp,
  type Param,
  type ParamType,
  type Step,
  type StepType,
} from "../../lib/runner";
import { Menu, MenuItem } from "../ui/menu";
import { EmbedContext } from "./embed-context";
import { HTTP_METHODS } from "../../lib/api-request";

export const STEP_HINTS: Record<StepType, string> = {
  send: "What to say or do",
  ask: "The question to ask",
  check: "What to do — then check it worked",
  if: "Why this decision (optional)",
  api: "What this does, e.g. Look up the order",
  end: "How it ended, e.g. Refund sent (optional)",
};
/** What each step type is for, in the type menu. */
export const STEP_PURPOSE: Record<StepType, string> = {
  send: "Say something or give an instruction",
  ask: "Ask a question and remember the answer",
  check: "Do something and confirm it worked",
  if: "Go a different way depending on a value",
  api: "Look something up or update another app (API)",
  end: "End the run here",
};

/** Section titles (headings) and the values steps can use, kept up to date. */
function useDocumentInfo(editor: Editor) {
  const read = () => {
    const sections: string[] = [];
    const params: Param[] = [];
    const steps: { step: StepType; variable?: string }[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name === "heading" && node.attrs.level <= 2 && node.textContent.trim())
        sections.push(node.textContent.trim());
      if (node.type.name === "procedureParams") params.push(...((node.attrs.params as Param[]) || []));
      if (node.type.name === "procedureStep")
        steps.push({ step: node.attrs.step, variable: node.attrs.variable || undefined });
    });
    return { sections, values: valuesOf({ params: params.filter((p) => p.name), steps: steps as Step[] }) };
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
      <option value="">Continue to the next step</option>
      {sections.map((section) => (
        <option key={section} value={section}>
          Jump to “{section}”
        </option>
      ))}
      {missing && <option value={value}>Jump to “{value}” (deleted section)</option>}
      <option value={END}>Finish the run</option>
    </select>
  );
}

/**
 * Renames a value everywhere it's used: {{old}} and {{old.field}} in step text and
 * settings, Decide steps that check it, and a Call step's {{old_status}}.
 */
export function renameValue(editor: Editor, from: string, to: string) {
  if (!from || !to || from === to) return;
  const pattern = new RegExp(`\\{\\{(\\s*)${from}((?:_status)?)(?=[\\s.}])`, "g");
  const swap = (text: string) => text.replace(pattern, (_m, space: string, suffix: string) => `{{${space}${to}${suffix}`);
  const { state } = editor;
  const tr = state.tr;
  const edits: { from: number; to: number; text: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const next = swap(node.text);
      if (next !== node.text) edits.push({ from: pos, to: pos + node.nodeSize, text: next });
    }
    if (node.type.name === "valueRef" && (node.attrs.key === from || node.attrs.key === `${from}_status`)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, key: to + String(node.attrs.key).slice(from.length) });
    }
    if (node.type.name === "procedureStep") {
      const attrs = { ...node.attrs };
      let changed = false;
      for (const key of ["url", "headers", "body", "value", "expected"] as const)
        if (typeof attrs[key] === "string" && swap(attrs[key]) !== attrs[key]) {
          attrs[key] = swap(attrs[key]);
          changed = true;
        }
      const variable = String(attrs.variable || "");
      if (node.attrs.step === "if" && (variable === from || variable.startsWith(`${from}.`) || variable === `${from}_status`)) {
        attrs.variable = to + variable.slice(from.length);
        changed = true;
      }
      if (changed) tr.setNodeMarkup(pos, undefined, attrs);
    }
  });
  // Text last, from the end, so earlier positions stay valid.
  for (const edit of edits.reverse()) tr.insertText(edit.text, edit.from, edit.to);
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** A name field people type in words ("Accepts credit"); the key follows it. */
function NameField({
  label,
  value,
  placeholder,
  taken,
  onRename,
}: {
  label: string;
  value: string;
  placeholder: string;
  taken: string[];
  onRename: (key: string) => void;
}) {
  const [draft, setDraft] = useState(value ? humanize(value) : "");
  return (
    <input
      className="proc-name-input"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      title={value ? `Use it in steps as {{${value}}}` : undefined}
      onChange={(event) => {
        setDraft(event.target.value);
        const base = keyFor(event.target.value);
        if (!base) return;
        let key = base;
        for (let n = 2; taken.includes(key) && key !== value; n++) key = `${base}_${n}`;
        if (key !== value) onRename(key);
      }}
    />
  );
}

/** "+ Value": inserts an input or earlier answer into the step text, by name. */
export function ValuePicker({ values, onPick }: { values: ReturnType<typeof valuesOf>; onPick: (key: string) => void }) {
  const groups: [string, typeof values][] = [
    ["Inputs", values.filter((v) => v.kind === "input")],
    ["Answers", values.filter((v) => v.kind === "answer")],
    ["From other apps", values.filter((v) => v.kind === "response" || v.kind === "status")],
  ];
  return (
    <Menu
      align="end"
      returnFocus={false}
      trigger={
        <button className="proc-value-button" aria-label="Insert a value" title="Insert an input or an earlier answer">
          <Braces size={13} /> Value
        </button>
      }
    >
      {values.length === 0 ? (
        <div className="menu-empty">Add inputs at the top of the page, or Ask steps, to use their values here.</div>
      ) : (
        groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <div key={title}>
              <div className="menu-label">{title}</div>
              {list.map((value) => (
                <MenuItem key={value.key} onClick={() => onPick(value.key)}>
                  {value.label}
                </MenuItem>
              ))}
            </div>
          ))
      )}
    </Menu>
  );
}

/** Decide: "When [value] [is] [x], jump to … otherwise …" — values picked by name. */
function ValueSelect({
  variable,
  values,
  onChange,
}: {
  variable: string;
  values: ReturnType<typeof valuesOf>;
  onChange: (variable: string) => void;
}) {
  const dot = variable.indexOf(".");
  const base = dot < 0 ? variable : variable.slice(0, dot);
  const field = dot < 0 ? "" : variable.slice(dot + 1);
  const known = values.find((v) => v.key === base);
  const groups: [string, typeof values][] = [
    ["Inputs", values.filter((v) => v.kind === "input")],
    ["Answers", values.filter((v) => v.kind === "answer")],
    ["From other apps", values.filter((v) => v.kind === "response" || v.kind === "status")],
  ];
  return (
    <>
      <select
        aria-label="Value to check"
        className={variable && !known ? "is-missing" : ""}
        value={known ? base : variable ? variable : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a value…</option>
        {groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <optgroup key={title} label={title}>
              {list.map((value) => (
                <option key={value.key} value={value.key}>
                  {value.label}
                </option>
              ))}
            </optgroup>
          ))}
        {variable && !known && <option value={variable}>{humanize(variable)} (not found)</option>}
      </select>
      {known?.kind === "response" && (
        <input
          className="proc-field-input"
          aria-label="Field in the response"
          placeholder="field, e.g. status"
          title="Which part of the response to check, e.g. status or customer.email"
          value={field}
          onChange={(event) => {
            const path = event.target.value.replace(/\s+/g, "_").replace(/[^\w.]/g, "");
            onChange(path ? `${base}.${path}` : base);
          }}
        />
      )}
    </>
  );
}

/**
 * A Check step's extras. In a plain checklist they're out of the way: "+ Expected result"
 * until one is written, and "If not" only when there's another section to jump to.
 */
function CheckSettings({
  attrs,
  set,
  sections,
}: {
  attrs: Record<string, string | null | undefined>;
  set: (attrs: Record<string, unknown>) => void;
  sections: string[];
}) {
  const [adding, setAdding] = useState(false);
  const showExpected = adding || !!attrs.expected;
  const showFail = sections.length > 1 || !!attrs.else;
  return (
    <>
      {showExpected ? (
        <label className="proc-grow">
          It worked if
          <input
            aria-label="Expected result"
            autoFocus={adding && !attrs.expected}
            placeholder="What you should see when it's done"
            value={String(attrs.expected || "")}
            onChange={(event) => set({ expected: event.target.value })}
            onBlur={() => setAdding(false)}
          />
        </label>
      ) : (
        <button type="button" className="proc-add-detail" onClick={() => setAdding(true)}>
          <Plus size={12} /> Expected result
        </button>
      )}
      {showFail && (
        <label>
          If not
          <TargetSelect
            label="If it fails"
            value={String(attrs.else || "")}
            sections={sections}
            onChange={(value) => set({ else: value })}
          />
        </label>
      )}
    </>
  );
}

/** A step's settings (what it remembers, where it jumps, the request it makes). */
export function StepSettings({
  attrs,
  set,
  sections,
  values,
  onRename,
}: {
  attrs: Record<string, unknown>;
  set: (attrs: Record<string, unknown>) => void;
  sections: string[];
  values: ReturnType<typeof valuesOf>;
  /** Renames this step's saved value (and everything that uses it). */
  onRename: (key: string) => void;
}) {
  const node = { attrs: attrs as Record<string, string | null | undefined> };
  const step = (attrs.step as StepType) || "send";
  const op = (attrs.op as ConditionOp) || "is";
  const variable = String(attrs.variable || "");
  const taken = values.map((v) => v.key);
  const rename = onRename;
  return (
    <>
      {step !== "send" && step !== "end" && (
        <div className="proc-step-config" contentEditable={false}>
          {step === "ask" && (
            <>
              <label>
                Remember the answer as
                <NameField
                  label="Remember the answer as"
                  value={variable}
                  placeholder="e.g. Payment method"
                  taken={taken}
                  onRename={rename}
                />
              </label>
              <select
                aria-label="Answer type"
                value={String(node.attrs.answer || "text")}
                onChange={(event) => set({ answer: event.target.value })}
              >
                <option value="text">Any text</option>
                <option value="number">A number</option>
                <option value="yesno">Yes or no</option>
                <option value="choice">Pick from a list</option>
              </select>
              {node.attrs.answer === "choice" && (
                <input
                  aria-label="Choices"
                  placeholder="Choices, separated by commas"
                  value={String(node.attrs.options || "")}
                  onChange={(event) => set({ options: event.target.value })}
                />
              )}
            </>
          )}
          {step === "check" && (
            <CheckSettings attrs={node.attrs} set={set} sections={sections} />
          )}
          {step === "api" && (
            <>
              <span className="proc-config-line">
                <select
                  className="proc-method"
                  aria-label="Method"
                  title="GET looks something up; POST, PUT and PATCH send or change data; DELETE removes it"
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
                  placeholder="Web address, e.g. https://api.example.com/orders/{{order_number}}"
                  spellCheck={false}
                  value={String(node.attrs.url || "")}
                  onChange={(event) => set({ url: event.target.value })}
                />
              </span>
              <span className="proc-config-line">
                <label>
                  Remember the reply as
                  <NameField
                    label="Save response as"
                    value={variable}
                    placeholder="e.g. Order"
                    taken={taken}
                    onRename={rename}
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
                <summary>Advanced: headers and body</summary>
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
                <ValueSelect variable={variable} values={values} onChange={(next) => set({ variable: next })} />
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
                    placeholder="e.g. Yes, or 30"
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
    </>
  );
}

function StepView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const step = (node.attrs.step as StepType) || "send";
  const { sections, values } = useDocumentInfo(editor);
  const set = (attrs: Record<string, unknown>) => updateAttributes(attrs);
  const variable = String(node.attrs.variable || "");
  const rename = (key: string) => {
    const old = variable;
    set({ variable: key });
    if (old) renameValue(editor, old, key);
  };
  /** Puts {{key}} at the cursor if it's in this step, otherwise at the end of it. */
  const insertValue = (key: string) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    const { from, to } = editor.state.selection;
    const inside = from >= start && to <= end;
    // After the menu has closed and handed focus back.
    window.requestAnimationFrame(() =>
      editor
        .chain()
        .focus()
        .insertContentAt(inside ? { from, to } : end, { type: "valueRef", attrs: { key } })
        .run(),
    );
  };
  return (
    <NodeViewWrapper className={`proc-step is-${step}`}>
      <div className="proc-step-row">
        <span className="proc-step-badge" contentEditable={false}>
          <select
            aria-label="Step type"
            title={STEP_PURPOSE[step]}
            value={step}
            onChange={(event) => set({ step: event.target.value })}
          >
            {(Object.keys(STEP_LABELS) as StepType[]).map((type) => (
              <option key={type} value={type}>
                {STEP_LABELS[type]} — {STEP_PURPOSE[type]}
              </option>
            ))}
          </select>
          <span className="proc-step-badge-label" aria-hidden>
            {STEP_LABELS[step]}
          </span>
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
        {step !== "if" && (
          <span className="proc-step-tools" contentEditable={false}>
            <ValuePicker values={values} onPick={insertValue} />
          </span>
        )}
      </div>
      <StepSettings attrs={node.attrs} set={set} sections={sections} values={values} onRename={rename} />
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
    // Only the settings in use, so the saved line stays short; value chips are saved
    // as {{key}} text.
    const attrs = Object.fromEntries(
      Object.entries(node.attrs || {}).filter(([, value]) => value !== null && value !== ""),
    );
    return `:::slate-node ${JSON.stringify({ ...chipsToText(node as JsonContent), attrs })}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(StepView, { stopEvent: stopFormEvents });
  },
});

const PARAM_TYPES: { value: ParamType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes or no" },
  { value: "choice", label: "Pick from a list" },
  { value: "record", label: "A record from a database" },
  { value: "secret", label: "Secret (e.g. an API token)" },
];

function ParamsView({ node, updateAttributes, editor }: NodeViewProps) {
  const { values } = useDocumentInfo(editor);
  return (
    <NodeViewWrapper className="proc-params" contentEditable={false}>
      <InputsEditor
        params={(node.attrs.params as Param[]) || []}
        onChange={(params) => updateAttributes({ params })}
        values={values}
        onRenameKey={(from, to) => renameValue(editor, from, to)}
      />
    </NodeViewWrapper>
  );
}

/** The Inputs table: what to ask for when someone presses Run. */
export function InputsEditor({
  params,
  onChange,
  values,
  onRenameKey,
  compact,
}: {
  params: Param[];
  onChange: (params: Param[]) => void;
  values: ReturnType<typeof valuesOf>;
  onRenameKey: (from: string, to: string) => void;
  /** A narrow panel: each input on its own small card. */
  compact?: boolean;
}) {
  const { listDatabases } = useContext(EmbedContext);
  const databases = listDatabases?.() ?? [];
  const save = onChange;
  /** The input being edited, in the compact panel (the rest are one-line summaries). */
  const [open, setOpen] = useState<number | null>(null);
  const edit = (index: number, patch: Partial<Param>) =>
    save(params.map((param, i) => (i === index ? { ...param, ...patch } : param)));
  /** The label is what people see; its key follows it, and steps using it are updated. */
  const relabel = (index: number, label: string) => {
    const param = params[index];
    const base = keyFor(label);
    let key = base || param.name;
    const taken = values.map((v) => v.key).filter((k) => k !== param.name);
    for (let n = 2; base && taken.includes(key); n++) key = `${base}_${n}`;
    edit(index, { label, name: key });
    if (param.name && key !== param.name) onRenameKey(param.name, key);
  };
  return (
    <div className={compact ? "proc-inputs is-compact" : "proc-inputs"}>
      <div className="proc-params-head">
        <SlidersHorizontal size={15} />
        <strong>Inputs</strong>
        <span>What you need to know before starting · add them to steps with Value</span>
      </div>
      {params.length === 0 && (
        <p className="proc-params-empty">
          Inputs are asked for when someone presses Run — like an order number or a customer&apos;s name.
        </p>
      )}
      {params.length > 0 && (
        <div className="proc-params-table" role="table" aria-label="Inputs">
          <div className="proc-params-row is-head" role="row">
            <span role="columnheader">Input</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Default or choices</span>
            <span role="columnheader">Required</span>
            <span aria-hidden />
          </div>
          {params.map((param, index) =>
            compact && open !== index ? (
              // In the narrow panel an input is one line until you open it.
              <button
                key={index}
                className="proc-input-summary"
                aria-label={`Edit ${labelOf(param) || "untitled input"}`}
                onClick={() => setOpen(index)}
              >
                <strong className={param.name ? "" : "is-untitled"}>{labelOf(param) || "Untitled input"}</strong>
                <small>
                  {PARAM_TYPES.find((t) => t.value === param.type)?.label}
                  {param.required ? " · Required" : " · Optional"}
                </small>
              </button>
            ) : (
            <div className="proc-params-row" role="row" key={index}>
              <input
                className="proc-name-input"
                aria-label="Input name"
                placeholder="e.g. Order number"
                title={param.name ? `Use it in steps as {{${param.name}}}` : undefined}
                value={param.label ?? (param.name ? labelOf(param) : "")}
                onChange={(event) => relabel(index, event.target.value)}
              />
              <select
                aria-label={`Type of ${labelOf(param) || "input"}`}
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
                  aria-label={`Database for ${labelOf(param) || "input"}`}
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
                  aria-label={`Choices for ${labelOf(param) || "input"}`}
                  placeholder="Choices, separated by commas"
                  value={(param.options || []).join(", ")}
                  onChange={(event) =>
                    edit(index, {
                      options: event.target.value.split(",").map((o) => o.trimStart()),
                    })
                  }
                />
              ) : (
                <input
                  aria-label={`Default for ${labelOf(param) || "input"}`}
                  placeholder="No default"
                  type={param.type === "date" ? "date" : param.type === "number" ? "number" : "text"}
                  value={param.default || ""}
                  onChange={(event) => edit(index, { default: event.target.value })}
                />
              )}
              <label className="proc-required">
                <input
                  type="checkbox"
                  aria-label={`${labelOf(param) || "Input"} is required`}
                  checked={param.required}
                  onChange={(event) => edit(index, { required: event.target.checked })}
                />
              </label>
              <button
                className="proc-remove"
                aria-label={`Remove ${labelOf(param) || "input"}`}
                title="Remove"
                onClick={() => save(params.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
              {compact && (
                <button className="proc-input-done" onClick={() => setOpen(null)}>
                  Done
                </button>
              )}
            </div>
            ),
          )}
        </div>
      )}
      <button
        className="proc-add"
        onClick={() => {
          save([...params, { name: "", type: "text", required: true }]);
          setOpen(params.length);
        }}
      >
        <Plus size={14} />
        Add an input
      </button>
    </div>
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

/** {{key}} or {{key.path}} in saved text. */
const VALUE_TEXT = /\{\{\s*([A-Za-z_][\w]*)(?:\.([^}]+?))?\s*\}\}/g;
const refText = (attrs: { key?: string; path?: string | null }) =>
  `{{${attrs.key || ""}${attrs.path ? `.${attrs.path}` : ""}}}`;

type JsonContent = { type?: string; text?: string; marks?: unknown[]; attrs?: Record<string, unknown>; content?: JsonContent[] };

/** Saved step JSON → editor JSON: "{{order_number}}" text becomes value chips. */
export function chipsFromText(node: JsonContent): JsonContent {
  if (node.type !== "procedureStep" || !node.content) return node;
  const content: JsonContent[] = [];
  for (const child of node.content) {
    if (child.type !== "text" || !child.text) {
      content.push(child);
      continue;
    }
    let last = 0;
    for (const match of child.text.matchAll(VALUE_TEXT)) {
      if (match.index! > last) content.push({ ...child, text: child.text.slice(last, match.index) });
      content.push({ type: "valueRef", attrs: { key: match[1], path: match[2]?.trim() || null } });
      last = match.index! + match[0].length;
    }
    if (last < child.text.length) content.push({ ...child, text: child.text.slice(last) });
  }
  return { ...node, content };
}

/** Editor JSON → saved step JSON: chips go back to "{{order_number}}" text. */
export function chipsToText(node: JsonContent): JsonContent {
  if (!node.content) return node;
  const content: JsonContent[] = [];
  for (const child of node.content) {
    const piece: JsonContent =
      child.type === "valueRef" ? { type: "text", text: refText(child.attrs || {}) } : child;
    const previous = content[content.length - 1];
    // Plain text next to plain text joins up again, as it was typed.
    if (piece.type === "text" && previous?.type === "text" && !piece.marks?.length && !previous.marks?.length)
      previous.text = (previous.text || "") + (piece.text || "");
    else content.push(piece.type === "text" ? { ...piece } : piece);
  }
  return { ...node, content };
}

/** A value in a step, shown by its name ("Order number"). */
/** The values a playbook's steps can use, when steps are edited outside the page editor. */
export const ProcedureValuesContext = createContext<ReturnType<typeof valuesOf> | null>(null);

function ValueChipView({ node, editor, getPos }: NodeViewProps) {
  const fromDocument = useDocumentInfo(editor).values;
  const values = useContext(ProcedureValuesContext) ?? fromDocument;
  const key = String(node.attrs.key || "");
  const path = node.attrs.path ? String(node.attrs.path) : "";
  const value = values.find((v) => v.key === key);
  const name = value ? (value.kind === "response" ? humanize(key) : value.label) : humanize(key);
  const label = path ? `${name} → ${path.replace(/\./g, " → ")}` : name;
  return (
    <NodeViewWrapper
      as="span"
      className={value ? "var-chip" : "var-chip is-missing"}
      data-key={refText({ key, path })}
      title={value ? `Filled in when the page runs` : `There's no value called “${key}” on this page`}
      // A click puts the caret just after the chip (on the side clicked), like a character.
      onMouseDown={(event: React.MouseEvent<HTMLElement>) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientX > box.left + box.width / 2;
        editor.chain().focus().setTextSelection(after ? pos + node.nodeSize : pos).run();
      }}
    >
      {label}
    </NodeViewWrapper>
  );
}

/**
 * A value chip inside a step. It's one character to the caret (arrows, End, Backspace
 * treat it as a unit) and is saved as plain {{key}} text, so Markdown and runs are
 * unchanged. Typing {{name}} turns into a chip.
 */
export const ValueRef = Node.create<{ anywhere: boolean }>({
  name: "valueRef",
  addOptions() {
    // Off in pages (chips live only in steps); on in a step's own text editor.
    return { anywhere: false };
  },
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { key: { default: "" }, path: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-value-ref]",
        getAttrs: (element) => ({
          key: (element as HTMLElement).getAttribute("data-value-ref") || "",
          path: (element as HTMLElement).getAttribute("data-path") || null,
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      mergeAttributes({ "data-value-ref": node.attrs.key, ...(node.attrs.path ? { "data-path": node.attrs.path } : {}) }),
      refText(node.attrs),
    ];
  },
  renderText({ node }) {
    return refText(node.attrs);
  },
  renderMarkdown(node) {
    return refText((node.attrs || {}) as { key?: string; path?: string | null });
  },
  addNodeView() {
    return ReactNodeViewRenderer(ValueChipView, { as: "span" });
  },
  // Browsers don't reliably put the caret past a chip at either end of a line, so
  // Home / End are handled here (on a wrapped line, the browser keeps doing it).
  addKeyboardShortcuts() {
    const jump = (toEnd: boolean) => () => {
      const { state, view } = this.editor;
      const { $from, empty } = state.selection;
      if (!empty || (!this.options.anywhere && $from.parent.type.name !== "procedureStep")) return false;
      const edge = toEnd ? $from.end() : $from.start();
      if ($from.pos === edge) return false;
      // Only on the same visual line as that end (a wrapped step keeps native Home / End).
      const here = view.coordsAtPos($from.pos);
      const there = view.coordsAtPos(edge, toEnd ? -1 : 1);
      if (Math.abs(here.bottom - there.bottom) > 4) return false;
      return this.editor.commands.setTextSelection(edge);
    };
    return { End: jump(true), Home: jump(false) };
  },
  addInputRules() {
    return [
      new InputRule({
        // Backspace after a chip removes it, rather than turning it back into {{text}}.
        undoable: false,
        find: /\{\{\s*([A-Za-z_][\w]*)(?:\.([^}]+?))?\s*\}\}$/,
        handler: ({ state, range, match }) => {
          if (!this.options.anywhere && state.doc.resolve(range.from).parent.type.name !== "procedureStep") return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ key: match[1], path: match[2]?.trim() || null }));
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

const STEP_ORDER: StepType[] = ["send", "ask", "check", "if", "api", "end"];

/** Below a section's last step: "+ Add a step", which opens the step types in words. */
function addStepWidget(at: number) {
  return Decoration.widget(
    at,
    (view) => {
      const row = document.createElement("div");
      row.className = "proc-add-step";
      row.contentEditable = "false";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "proc-add-step-button";
      add.innerHTML = `${icon('<path d="M12 5v14M5 12h14"/>')}<span>Add a step</span>`;
      const choices = document.createElement("div");
      choices.className = "proc-add-step-choices";
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", "Choose a step");
      choices.hidden = true;
      for (const type of STEP_ORDER) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = `proc-add-choice is-${type}`;
        choice.title = STEP_PURPOSE[type];
        choice.innerHTML = `<strong>${STEP_LABELS[type]}</strong><span>${STEP_PURPOSE[type]}</span>`;
        choice.addEventListener("mousedown", (event) => event.preventDefault());
        choice.addEventListener("click", () => {
          const stepType = view.state.schema.nodes.procedureStep;
          const attrs = {
            step: type,
            ...(type === "ask" ? { answer: "text" } : {}),
            ...(type === "if" ? { op: "is" } : {}),
            ...(type === "api" ? { method: "GET" } : {}),
          };
          const tr = view.state.tr.insert(at, stepType.create(attrs));
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
          view.focus();
        });
        choices.append(choice);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.className = "proc-add-step-close";
      close.setAttribute("aria-label", "Cancel");
      close.innerHTML = icon('<path d="M18 6 6 18M6 6l12 12"/>');
      choices.append(close);
      const toggle = (open: boolean) => {
        choices.hidden = !open;
        add.hidden = open;
        if (open) (choices.querySelector("button") as HTMLButtonElement | null)?.focus();
        else add.focus();
      };
      add.addEventListener("mousedown", (event) => event.preventDefault());
      add.addEventListener("click", () => toggle(true));
      close.addEventListener("click", () => toggle(false));
      choices.addEventListener("keydown", (event) => {
        if (event.key === "Escape") toggle(false);
      });
      row.append(add, choices);
      return row;
    },
    { side: 1, ignoreSelection: true, stopEvent: () => true, key: `add-step:${at}` },
  );
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
      // "+ Add a step" after the last step of each group of steps.
      let lastStepEnd = -1;
      let collapsedGroup = false;
      doc.forEach((node, pos) => {
        if (node.type.name === "heading" && node.attrs.level <= 2) {
          if (lastStepEnd >= 0 && !collapsedGroup) decorations.push(addStepWidget(lastStepEnd));
          lastStepEnd = -1;
          collapsedGroup = storage.collapsed.has(node.textContent.trim());
        } else if (node.type.name === "procedureStep") lastStepEnd = pos + node.nodeSize;
      });
      if (lastStepEnd >= 0 && !collapsedGroup) decorations.push(addStepWidget(lastStepEnd));
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
