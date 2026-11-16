"use client";
/**
 * The playbook builder: a runnable page edited as structure (like Ada's playbooks)
 * instead of free text. Details, inputs, guidelines and an outline sit in a side panel;
 * sections are cards holding numbered steps. Everything is saved in the page's usual
 * Markdown (see lib/playbook-model.ts), so runs and links are unaffected.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { scrollBehavior } from "@/lib/utils";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  Lightbulb,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  GripVertical,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuItem, MenuSeparator } from "./ui/menu";
import {
  InputsEditor,
  ProcedureValuesContext,
  STEP_HINTS,
  STEP_PURPOSE,
  StepSettings,
  ValuePicker,
  ValueRef,
  chipsFromText,
  chipsToText,
} from "./editor/procedure-nodes";
import { STEP_LABELS, valuesOf, type Step, type StepType } from "@/lib/runner";
import {
  newStep,
  parsePlaybook,
  renameInModel,
  renameSection,
  serializePlaybook,
  type BuilderSection,
  type BuilderStep,
  type PlaybookModel,
  type StepContent,
} from "@/lib/playbook-model";
import { id } from "@/lib/utils";
import { checkPlaybook, type Issue } from "@/lib/playbook-checks";
import { localDate } from "@/lib/procedures";
// Step, input and value-chip styles live with the editor's. The page editor is loaded
// only when a normal page opens, so a playbook opened directly needs them here too.
import "./editor/editor.css";

const STEP_TYPES: StepType[] = ["check", "ask", "send", "if", "api", "end"];

/** One step's text: a small editor where values show as chips. */
function StepText({
  content,
  placeholder,
  autoFocus,
  showPicker,
  onChange,
  onEnter,
}: {
  content: StepContent;
  placeholder: string;
  autoFocus: boolean;
  showPicker: boolean;
  onChange: (content: StepContent) => void;
  onEnter: () => void;
}) {
  const changeRef = useRef(onChange);
  const enterRef = useRef(onEnter);
  /** The content this editor last showed or produced, to tell outside changes apart. */
  const shown = useRef(JSON.stringify(content));
  useEffect(() => {
    changeRef.current = onChange;
    enterRef.current = onEnter;
  });
  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      Document.extend({ content: "paragraph" }),
      Paragraph,
      Text,
      Bold,
      Italic,
      UndoRedo,
      ValueRef.configure({ anywhere: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          ...(content.length
            ? { content: chipsFromText({ type: "procedureStep", content }).content as JSONContent[] }
            : {}),
        },
      ],
    },
    editorProps: {
      attributes: { class: "pb-step-text", "aria-label": "Step text", role: "textbox" },
      handleKeyDown: (_view, event) => {
        // Enter adds the next step (a step is one line); Shift+Enter is ignored.
        if (event.key === "Enter") {
          event.preventDefault();
          if (!event.shiftKey) enterRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      const paragraph = current.getJSON().content?.[0];
      const next = (chipsToText({ type: "procedureStep", content: paragraph?.content || [] }).content ||
        []) as StepContent;
      shown.current = JSON.stringify(next);
      changeRef.current(next);
    },
  });
  // Changes made outside this editor (e.g. renaming a value it uses) are loaded in.
  const saved = JSON.stringify(content);
  useEffect(() => {
    if (!editor || saved === shown.current) return;
    shown.current = saved;
    const parsed = JSON.parse(saved) as StepContent;
    editor.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            ...(parsed.length
              ? { content: chipsFromText({ type: "procedureStep", content: parsed }).content as JSONContent[] }
              : {}),
          },
        ],
      },
      { emitUpdate: false },
    );
  }, [editor, saved]);
  return (
    <>
      <div className="pb-step-text-wrap">
        <EditorContent editor={editor} />
      </div>
      {showPicker && (
        <span className="proc-step-tools">
          <ValuePickerFor editor={editor} />
        </span>
      )}
    </>
  );
}

/** "+ Value" for a step's own editor. */
function ValuePickerFor({ editor }: { editor: Editor | null }) {
  return (
    <ProcedureValuesContext.Consumer>
      {(values) =>
        // Nothing to insert yet (no inputs or answers): no button, less clutter.
        !values?.length ? null : (
          <ValuePicker
            values={values || []}
            onPick={(key) =>
              window.requestAnimationFrame(() => {
                if (!editor) return;
                // Focus now: Tiptap's focus() waits a frame, and a key pressed as soon as the
                // value shows (Enter for the next step) would land nowhere.
                editor.view.focus();
                editor.chain().focus().insertContent({ type: "valueRef", attrs: { key } }).run();
              })
            }
          />
        )
      }
    </ProcedureValuesContext.Consumer>
  );
}

function StepRow({
  step,
  number,
  sectionTitles,
  values,
  focus,
  canMoveUp,
  canMoveDown,
  otherSections,
  onChange,
  onRename,
  onAddAfter,
  onMove,
  onMoveTo,
  onDuplicate,
  onDelete,
  issues,
}: {
  issues?: Issue[];
  step: BuilderStep;
  number: string;
  sectionTitles: string[];
  values: ReturnType<typeof valuesOf>;
  focus: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  otherSections: BuilderSection[];
  onChange: (step: BuilderStep) => void;
  onRename: (from: string, to: string) => void;
  onAddAfter: () => void;
  onMove: (by: -1 | 1) => void;
  onMoveTo: (sectionId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    data: { kind: "step" },
  });
  const type = (step.attrs.step as StepType) || "send";
  const set = (patch: Record<string, unknown>) => onChange({ ...step, attrs: { ...step.attrs, ...patch } });
  return (
    <div
      ref={setNodeRef}
      className={`pb-step proc-step is-${type} ${isDragging ? "is-dragging" : ""} ${issues?.some((i) => i.level === "warning") ? "has-warning" : ""}`}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      data-step-id={step.id}
    >
      <div className="proc-step-row">
        <button
          ref={setActivatorNodeRef}
          className="pb-grip"
          aria-label={`Move step ${number}`}
          title="Drag to move"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <span className="pb-step-number">{number}</span>
        <span className="proc-step-badge">
          <select
            aria-label="Step type"
            title={STEP_PURPOSE[type]}
            value={type}
            onChange={(event) => set({ step: event.target.value })}
          >
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {STEP_LABELS[t]} — {STEP_PURPOSE[t]}
              </option>
            ))}
          </select>
          <span className="proc-step-badge-label" aria-hidden>
            {STEP_LABELS[type]}
          </span>
        </span>
        <div className="proc-step-body">
          <StepText
            content={step.content}
            placeholder={STEP_HINTS[type]}
            autoFocus={focus}
            showPicker={type !== "if"}
            onChange={(content) => onChange({ ...step, content })}
            onEnter={onAddAfter}
          />
        </div>
        <Menu
          align="end"
          trigger={
            <button className="pb-icon-button" aria-label={`Step ${number} options`}>
              <MoreHorizontal size={16} />
            </button>
          }
        >
          <MenuItem onClick={() => onMove(-1)} disabled={!canMoveUp}>
            <ArrowUp />
            Move up
          </MenuItem>
          <MenuItem onClick={() => onMove(1)} disabled={!canMoveDown}>
            <ArrowDown />
            Move down
          </MenuItem>
          {otherSections.length > 0 && <MenuSeparator />}
          {otherSections.map((section) => (
            <MenuItem key={section.id} onClick={() => onMoveTo(section.id)}>
              <CornerDownRight />
              Move to “{section.title || "Untitled section"}”
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={onDuplicate}>
            <Copy />
            Duplicate
          </MenuItem>
          <MenuItem danger onClick={onDelete}>
            <Trash2 />
            Delete step
          </MenuItem>
        </Menu>
      </div>
      <StepSettings
        attrs={step.attrs}
        set={set}
        sections={sectionTitles}
        values={values}
        onRename={(key) => {
          const old = String(step.attrs.variable || "");
          if (old) onRename(old, key);
          set({ variable: key });
        }}
      />
      <IssueList issues={issues} />
    </div>
  );
}

/** What to fix (warnings) or might improve (tips), in plain words. */
function IssueList({ issues }: { issues?: Issue[] }) {
  if (!issues?.length) return null;
  return (
    <ul className="pb-issues">
      {issues.map((issue, i) => (
        <li key={i} className={`is-${issue.level}`}>
          {issue.level === "warning" ? <AlertTriangle size={13} /> : <Lightbulb size={13} />}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** "+ Add step": the step types, each said in words. */
/** The everyday steps first; decisions, calls and Finish are under "More". */
const BASIC_STEPS: StepType[] = ["check", "ask", "send"];
const MORE_STEPS: StepType[] = ["if", "api", "end"];

/** "+ Add step": the step types, each said in words. */
function AddStep({ onAdd, label = "Add step" }: { onAdd: (type: StepType) => void; label?: string }) {
  const choice = (type: StepType) => (
    <MenuItem key={type} onClick={() => onAdd(type)}>
      <span className={`pb-type-dot is-${type}`} aria-hidden />
      <span className="pb-type-choice">
        <strong>{STEP_LABELS[type]}</strong>
        <small>{STEP_PURPOSE[type]}</small>
      </span>
    </MenuItem>
  );
  return (
    <Menu
      returnFocus={false}
      trigger={
        <button className="pb-add-step">
          <Plus size={14} />
          {label}
        </button>
      }
    >
      {BASIC_STEPS.map(choice)}
      <MenuSeparator />
      <div className="menu-label">More</div>
      {MORE_STEPS.map(choice)}
    </Menu>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="pb-panel" aria-label={title}>
      <div className="pb-panel-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function OutlineItem({
  section,
  index,
  issues,
  onJump,
}: {
  section: BuilderSection;
  index: number;
  /** Warnings in this section and its steps. */
  issues: number;
  onJump: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `outline:${section.id}`,
  });
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? "is-dragging" : ""}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        className="pb-grip"
        aria-label={`Move section ${section.title || index + 1}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>
      <button className="pb-outline-link" onClick={onJump}>
        <span className="pb-outline-number">{index + 1}</span>
        <span className="pb-outline-title">{section.title || "Untitled section"}</span>
        {issues > 0 ? (
          <span className="pb-outline-warning" title={`${issues} to fix`}>
            <AlertTriangle size={12} />
            {issues}
          </span>
        ) : (
          <small>{section.steps.length}</small>
        )}
      </button>
    </li>
  );
}

/** A textarea that grows with its text. */
function GrowingText(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`pb-textarea ${props.className || ""}`} rows={props.rows ?? 2} />;
}

export function PlaybookBuilder({
  markdown,
  onChange,
  onRunFrom,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  onRunFrom?: (section: string) => void;
}) {
  const [model, setModel] = useState(() => parsePlaybook(markdown));
  const modelRef = useRef(model);
  const lastSaved = useRef(markdown);
  const [focusStep, setFocusStep] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Side panels opened on request (they also show whenever they have content). */
  const [openPanels, setOpenPanels] = useState<Set<"inputs" | "guidelines">>(new Set());
  // Changes made elsewhere (e.g. a page link added by the sidebar) are picked up.
  useEffect(() => {
    if (markdown === lastSaved.current) return;
    lastSaved.current = markdown;
    queueMicrotask(() => {
      const next = parsePlaybook(markdown);
      modelRef.current = next;
      setModel(next);
    });
  }, [markdown]);
  const commit = (next: PlaybookModel) => {
    modelRef.current = next;
    setModel(next);
    const md = serializePlaybook(next);
    lastSaved.current = md;
    onChange(md);
  };
  const update = (fn: (m: PlaybookModel) => PlaybookModel) => commit(fn(modelRef.current));
  /** Takes something away, with an Undo that puts the whole playbook back. */
  const remove = (message: string, fn: (m: PlaybookModel) => PlaybookModel) => {
    const before = modelRef.current;
    update(fn);
    toast(message, { action: { label: "Undo", onClick: () => commit(before) } });
  };
  const values = useMemo(
    () =>
      valuesOf({
        params: model.params.filter((p) => p.name),
        steps: model.sections.flatMap((s) => s.steps.map((step) => step.attrs as unknown as Step)),
      }),
    [model],
  );
  const titles = model.sections.map((s) => s.title).filter(Boolean);
  const checks = useMemo(() => checkPlaybook(model), [model]);
  /** Warnings in a section, counting its steps. */
  const warningsIn = (section: BuilderSection) =>
    [
      ...(checks.sections.get(section.id) || []),
      ...section.steps.flatMap((step) => checks.steps.get(step.id) || []),
    ].filter((issue) => issue.level === "warning").length;
  /** Scrolls to the first thing to fix. */
  const showFirstIssue = () => {
    const el = document.querySelector(".pb-step.has-warning, .pb-section-head + .pb-issues");
    el?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  };
  const editSection = (sectionId: string, fn: (s: BuilderSection) => BuilderSection) =>
    update((m) => ({ ...m, sections: m.sections.map((s) => (s.id === sectionId ? fn(s) : s)) }));
  const editStep = (stepId: string, next: BuilderStep) =>
    update((m) => ({
      ...m,
      sections: m.sections.map((s) => ({ ...s, steps: s.steps.map((step) => (step.id === stepId ? next : step)) })),
    }));
  const addStep = (sectionId: string, type: StepType, after?: string) => {
    const step = newStep(type);
    editSection(sectionId, (s) => {
      // At the end of the section — but before a closing Finish step, which ends the run.
      const last = s.steps[s.steps.length - 1];
      const end = last && last.attrs.step === "end" && type !== "end" ? s.steps.length - 1 : s.steps.length;
      const at = after ? s.steps.findIndex((x) => x.id === after) + 1 : end;
      const steps = [...s.steps];
      steps.splice(at, 0, step);
      return { ...s, steps };
    });
    setFocusStep(step.id);
  };
  const addSection = () => {
    const section: BuilderSection = { id: id(), title: "", description: "", steps: [newStep("check")] };
    update((m) => ({ ...m, sections: [...m.sections, section] }));
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-section-id="${section.id}"] .pb-section-title`)?.focus(),
    );
  };
  const sectionOf = (stepId: string) => modelRef.current.sections.find((s) => s.steps.some((x) => x.id === stepId));

  // Drag and drop: steps move within and between sections; sections reorder in the outline.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onStepDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return;
    const from = sectionOf(String(active.id));
    const overId = String(over.id);
    const to = overId.startsWith("section:")
      ? modelRef.current.sections.find((s) => `section:${s.id}` === overId)
      : sectionOf(overId);
    if (!from || !to || from.id === to.id) return;
    // Into another section: take it out of this one and put it where it's pointing.
    const moving = from.steps.find((s) => s.id === active.id)!;
    const index = overId.startsWith("section:") ? to.steps.length : to.steps.findIndex((s) => s.id === overId);
    setModel((m) => {
      const next = {
        ...m,
        sections: m.sections.map((s) => {
          if (s.id === from.id) return { ...s, steps: s.steps.filter((x) => x.id !== moving.id) };
          if (s.id === to.id) {
            const steps = [...s.steps];
            steps.splice(index < 0 ? steps.length : index, 0, moving);
            return { ...s, steps };
          }
          return s;
        }),
      };
      modelRef.current = next;
      return next;
    });
  };
  const onStepDragEnd = ({ active, over }: DragEndEvent) => {
    const section = sectionOf(String(active.id));
    if (over && section && active.id !== over.id && !String(over.id).startsWith("section:")) {
      const from = section.steps.findIndex((s) => s.id === active.id);
      const to = section.steps.findIndex((s) => s.id === over.id);
      if (from >= 0 && to >= 0) {
        editSection(section.id, (s) => ({ ...s, steps: arrayMove(s.steps, from, to) }));
        return;
      }
    }
    commit(modelRef.current);
  };
  const onOutlineDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = modelRef.current.sections.map((s) => `outline:${s.id}`);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) update((m) => ({ ...m, sections: arrayMove(m.sections, from, to) }));
  };
  const jumpTo = (sectionId: string) =>
    document
      .querySelector(`[data-section-id="${sectionId}"]`)
      ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });

  return (
    <ProcedureValuesContext.Provider value={values}>
      <div className="pb">
        <aside className="pb-side" aria-label="Playbook setup">
          {model.details ? (
            <Panel title="Details">
              <div className="pb-details">
                {(
                  [
                    ["owner", "Owner", "Who keeps this up to date"],
                    ["time", "Time needed", "e.g. 30 min"],
                    ["reviewEvery", "Review every", "e.g. 90 days"],
                    ["lastReviewed", "Last reviewed", ""],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type={key === "lastReviewed" ? "date" : "text"}
                      placeholder={placeholder}
                      value={model.details![key] === "—" ? "" : model.details![key]}
                      onChange={(event) =>
                        update((m) => ({ ...m, details: { ...m.details!, [key]: event.target.value } }))
                      }
                    />
                  </label>
                ))}
              </div>
            </Panel>
          ) : null}
          {(model.params.length > 0 || openPanels.has("inputs")) && (
            <Panel title="Inputs">
              <div className="proc-params pb-inputs">
                <InputsEditor
                  compact
                  params={model.params}
                  values={values}
                  onChange={(params) => update((m) => ({ ...m, params }))}
                  onRenameKey={(from, to) => update((m) => renameInModel(m, from, to))}
                />
              </div>
            </Panel>
          )}
          {(model.guidelines.some((g) => g.trim()) || openPanels.has("guidelines")) && (
            <Panel title="Guidelines">
              <GrowingText
                aria-label="Guidelines"
                rows={Math.max(3, model.guidelines.length + 1)}
                placeholder={"Rules for every step, one per line — e.g.\nKeep a friendly tone"}
                value={model.guidelines.join("\n")}
                autoFocus={openPanels.has("guidelines") && !model.guidelines.some((g) => g.trim())}
                onChange={(event) => update((m) => ({ ...m, guidelines: event.target.value.split("\n") }))}
              />
            </Panel>
          )}
          {/* More, only when it's wanted: a plain checklist needs none of it. */}
          {(!model.params.length && !openPanels.has("inputs")) ||
          (!model.guidelines.some((g) => g.trim()) && !openPanels.has("guidelines")) ||
          model.details === null ? (
            <div className="pb-more" aria-label="Add more">
              {!model.params.length && !openPanels.has("inputs") && (
                <button className="pb-link" onClick={() => setOpenPanels((o) => new Set(o).add("inputs"))}>
                  <Plus size={13} /> Ask for details before starting
                </button>
              )}
              {!model.guidelines.some((g) => g.trim()) && !openPanels.has("guidelines") && (
                <button className="pb-link" onClick={() => setOpenPanels((o) => new Set(o).add("guidelines"))}>
                  <Plus size={13} /> Add guidelines
                </button>
              )}
              {model.details === null && (
                <button
                  className="pb-link"
                  onClick={() =>
                    update((m) => ({
                      ...m,
                      details: { owner: "", time: "", lastReviewed: localDate(), reviewEvery: "90 days" },
                    }))
                  }
                >
                  <Plus size={13} /> Add owner and review dates
                </button>
              )}
            </div>
          ) : null}
          {model.notes ? (
            <Panel title="Notes">
              <GrowingText
                aria-label="Notes"
                className="is-notes"
                rows={6}
                value={model.notes}
                onChange={(event) => update((m) => ({ ...m, notes: event.target.value }))}
              />
            </Panel>
          ) : null}
          <div className="pb-sticky">
            <Panel
              title="Outline"
              action={
                checks.warnings > 0 ? (
                  <button className="pb-issue-summary" onClick={showFirstIssue}>
                    <AlertTriangle size={12} />
                    {checks.warnings} to fix
                  </button>
                ) : checks.total === 0 && model.sections.length > 0 ? (
                  <span className="pb-all-good">Ready to run</span>
                ) : null
              }
            >
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onOutlineDragEnd}>
                <SortableContext
                  items={model.sections.map((s) => `outline:${s.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <ol className="pb-outline">
                    {model.sections.map((section, index) => (
                      <OutlineItem
                        key={section.id}
                        section={section}
                        index={index}
                        issues={warningsIn(section)}
                        onJump={() => jumpTo(section.id)}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            </Panel>
          </div>
        </aside>
        <div className="pb-main">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragOver={onStepDragOver}
            onDragEnd={onStepDragEnd}
          >
            {model.sections.map((section, sectionIndex) => {
              const folded = collapsed.has(section.id);
              return (
                <section
                  key={section.id}
                  className="pb-section"
                  data-section-id={section.id}
                  aria-label={section.title || "Untitled section"}
                >
                  <header className="pb-section-head">
                    <span className="pb-section-number">{sectionIndex + 1}</span>
                    <div className="pb-section-names">
                      <input
                        className="pb-section-title"
                        aria-label="Section name"
                        placeholder="Name this section, e.g. Check eligibility"
                        value={section.title}
                        onChange={(event) => update((m) => renameSection(m, section.id, event.target.value))}
                      />
                      <input
                        className="pb-section-description"
                        aria-label="Section description"
                        placeholder="Add a description"
                        value={section.description}
                        onChange={(event) =>
                          editSection(section.id, (s) => ({ ...s, description: event.target.value }))
                        }
                      />
                    </div>
                    <button
                      className="pb-count"
                      aria-expanded={!folded}
                      onClick={() =>
                        setCollapsed((c) => {
                          const next = new Set(c);
                          if (next.has(section.id)) next.delete(section.id);
                          else next.add(section.id);
                          return next;
                        })
                      }
                      title={folded ? "Show steps" : "Hide steps"}
                    >
                      {folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      {section.steps.length} {section.steps.length === 1 ? "step" : "steps"}
                    </button>
                    <Menu
                      align="end"
                      trigger={
                        <button className="pb-icon-button" aria-label={`Section ${sectionIndex + 1} options`}>
                          <MoreHorizontal size={16} />
                        </button>
                      }
                    >
                      {onRunFrom && section.title && section.steps.length > 0 && (
                        <>
                          <MenuItem onClick={() => onRunFrom(section.title)}>
                            <Play />
                            Run from here
                          </MenuItem>
                          <MenuSeparator />
                        </>
                      )}
                      <MenuItem
                        disabled={sectionIndex === 0}
                        onClick={() =>
                          update((m) => ({ ...m, sections: arrayMove(m.sections, sectionIndex, sectionIndex - 1) }))
                        }
                      >
                        <ArrowUp />
                        Move up
                      </MenuItem>
                      <MenuItem
                        disabled={sectionIndex === model.sections.length - 1}
                        onClick={() =>
                          update((m) => ({ ...m, sections: arrayMove(m.sections, sectionIndex, sectionIndex + 1) }))
                        }
                      >
                        <ArrowDown />
                        Move down
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        onClick={() =>
                          remove(`Deleted “${section.title || "Untitled section"}”`, (m) => ({
                            ...m,
                            sections: m.sections.filter((s) => s.id !== section.id),
                          }))
                        }
                      >
                        <Trash2 />
                        Delete section
                      </MenuItem>
                    </Menu>
                  </header>
                  <IssueList issues={checks.sections.get(section.id)} />
                  {!folded && (
                    <SortableContext items={section.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                      <div className="pb-steps">
                        {section.steps.map((step, stepIndex) => (
                          <StepRow
                            key={step.id}
                            step={step}
                            number={`${sectionIndex + 1}.${stepIndex + 1}`}
                            sectionTitles={titles}
                            values={values}
                            focus={focusStep === step.id}
                            issues={checks.steps.get(step.id)}
                            canMoveUp={stepIndex > 0}
                            canMoveDown={stepIndex < section.steps.length - 1}
                            otherSections={model.sections.filter((s) => s.id !== section.id)}
                            onChange={(next) => editStep(step.id, next)}
                            onRename={(from, to) => update((m) => renameInModel(m, from, to))}
                            // Enter adds another step of the same everyday kind (a list keeps going).
                            onAddAfter={() =>
                              addStep(
                                section.id,
                                BASIC_STEPS.includes(step.attrs.step as StepType)
                                  ? (step.attrs.step as StepType)
                                  : "check",
                                step.id,
                              )
                            }
                            onMove={(by) =>
                              editSection(section.id, (s) => ({
                                ...s,
                                steps: arrayMove(s.steps, stepIndex, stepIndex + by),
                              }))
                            }
                            onMoveTo={(target) =>
                              update((m) => ({
                                ...m,
                                sections: m.sections.map((s) =>
                                  s.id === section.id
                                    ? { ...s, steps: s.steps.filter((x) => x.id !== step.id) }
                                    : s.id === target
                                      ? { ...s, steps: [...s.steps, step] }
                                      : s,
                                ),
                              }))
                            }
                            onDuplicate={() =>
                              editSection(section.id, (s) => {
                                const steps = [...s.steps];
                                steps.splice(stepIndex + 1, 0, { ...structuredClone(step), id: id() });
                                return { ...s, steps };
                              })
                            }
                            onDelete={() =>
                              remove(`Deleted step ${sectionIndex + 1}.${stepIndex + 1}`, (m) => ({
                                ...m,
                                sections: m.sections.map((s) =>
                                  s.id === section.id ? { ...s, steps: s.steps.filter((x) => x.id !== step.id) } : s,
                                ),
                              }))
                            }
                          />
                        ))}
                        <SectionDrop id={section.id} empty={!section.steps.length} />
                      </div>
                    </SortableContext>
                  )}
                  {!folded && <AddStep onAdd={(type) => addStep(section.id, type)} />}
                </section>
              );
            })}
          </DndContext>
          <button className="pb-add-section" onClick={addSection}>
            <Plus size={15} />
            Add section
          </button>
        </div>
      </div>
    </ProcedureValuesContext.Provider>
  );
}

/** Where a step can be dropped into a section that has none (or at its end). */
function SectionDrop({ id: sectionId, empty }: { id: string; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${sectionId}` });
  return (
    <div ref={setNodeRef} className={`pb-drop ${empty ? "is-empty" : ""} ${isOver ? "is-over" : ""}`}>
      {empty ? "No steps yet — add one below, or drag one here" : null}
    </div>
  );
}
