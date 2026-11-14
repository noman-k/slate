"use client";
import { useRef, useState } from "react";
import { Modal } from "./ui/menu";
import { PageIcon } from "./page-icon";
import {
  PROCEDURE_KINDS,
  templateInputs,
  templateOutline,
  templatesOf,
  type ProcedureKind,
  type ProcedureTemplate,
} from "@/lib/procedures";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Pick a playbook or runbook to start from: a list of common use cases on the left
 * (blank first) and a preview of the chosen one's sections on the right. Arrow keys move,
 * Enter uses the highlighted template; Tab switches between playbooks and runbooks.
 */
export function ProcedureGallery({
  kind,
  onKindChange,
  onClose,
  onUse,
}: {
  /** null keeps the dialog closed. */
  kind: ProcedureKind | null;
  onKindChange: (kind: ProcedureKind) => void;
  onClose: () => void;
  onUse: (template: ProcedureTemplate) => void;
}) {
  const list = templatesOf(kind ?? "playbook");
  // The highlighted template, remembered per tab while switching back and forth.
  const [picked, setPicked] = useState<Record<ProcedureKind, number>>({ playbook: 0, runbook: 0 });
  const index = picked[kind ?? "playbook"];
  const setIndex = (next: number | ((i: number) => number)) =>
    setPicked((all) => {
      const k = kind ?? "playbook";
      return { ...all, [k]: typeof next === "function" ? next(all[k]) : next };
    });
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = list[Math.min(index, list.length - 1)];
  const outline = chosen ? templateOutline(chosen) : [];
  const inputs = chosen ? templateInputs(chosen) : [];
  const info = PROCEDURE_KINDS[kind ?? "playbook"];
  return (
    <Modal
      open={kind !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`New ${info.label.toLowerCase()}`}
      description={info.blurb}
      className="procedure-gallery"
      initialFocus={listRef}
    >
      <div className="procedure-kinds" role="tablist" aria-label="Template type">
        {(["playbook", "runbook"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === kind}
            className={k === kind ? "is-active" : ""}
            onClick={() => {
              onKindChange(k);
              listRef.current?.focus();
            }}
          >
            {PROCEDURE_KINDS[k].plural}
          </button>
        ))}
      </div>
      <div className="procedure-body">
        <div
          ref={listRef}
          className="procedure-list"
          role="listbox"
          aria-label={`${info.label} templates`}
          aria-activedescendant={chosen ? `procedure-${chosen.id}` : undefined}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setIndex((i) => (i + step + list.length) % list.length);
            } else if (event.key === "Enter" && chosen) {
              event.preventDefault();
              onUse(chosen);
            }
          }}
        >
          {list.map((template, i) => (
            <div
              key={template.id}
              id={`procedure-${template.id}`}
              role="option"
              aria-selected={i === index}
              className={`procedure-option ${i === index ? "is-active" : ""}`}
              onMouseMove={() => setIndex(i)}
              onClick={() => setIndex(i)}
              onDoubleClick={() => onUse(template)}
            >
              <PageIcon page={{ icon: template.icon, kind: "document" }} size={18} />
              <span>
                <strong>{template.name}</strong>
                <small>{template.summary}</small>
              </span>
            </div>
          ))}
        </div>
        {chosen && (
          <section className="procedure-preview" aria-label={`${chosen.name} preview`}>
            <div className="procedure-preview-title">
              <PageIcon page={{ icon: chosen.icon, kind: "document" }} size={22} />
              <h3>{chosen.name}</h3>
            </div>
            <p>
              <span className="procedure-when">When to use</span>
              {capitalize(chosen.whenToUse.replace(/^When to use:\s*/, ""))}
            </p>
            {inputs.length > 0 && (
              <div className="procedure-inputs" aria-label="Inputs">
                <span className="procedure-when">Asks for</span>
                {inputs.map((param) => (
                  <code key={param.name}>{param.name}</code>
                ))}
              </div>
            )}
            <ol>
              {outline.map((section) => (
                <li key={section.title}>
                  <span>{section.title}</span>
                  {section.items > 0 && (
                    <small>
                      {section.items} {section.items === 1 ? "step" : "steps"}
                    </small>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
      <div className="modal-footer">
        <span className="modal-hint" aria-hidden>
          <kbd>↑</kbd>
          <kbd>↓</kbd> to choose · <kbd>↵</kbd> to use
        </span>
        <button className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={!chosen}
          onClick={() => chosen && onUse(chosen)}
        >
          Use template
        </button>
      </div>
    </Modal>
  );
}
