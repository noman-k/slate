"use client";
import { Fragment, useRef, useState } from "react";
import { Modal } from "./ui/menu";
import { PageIcon } from "./page-icon";
import {
  FEATURED_CATEGORIES,
  PLAYBOOK_BLURB,
  TEMPLATE_CATEGORIES,
  templateInputs,
  templateOutline,
  templatesInOrder,
  type ProcedureTemplate,
} from "@/lib/procedures";
import { labelOf } from "@/lib/runner";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const categoryLabel = (id: ProcedureTemplate["category"]) =>
  TEMPLATE_CATEGORIES.find((c) => c.id === id)?.label ?? "";

/**
 * Pick a playbook to start from: templates grouped by what they're for (a blank one
 * first) on the left, a preview of the chosen one's sections on the right. Arrow keys
 * move, Enter uses the highlighted template.
 */
export function ProcedureGallery({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: ProcedureTemplate) => void;
}) {
  // Everyday templates first; the more technical ones are a click away.
  const [showAll, setShowAll] = useState(false);
  const all = templatesInOrder();
  const list = showAll ? all : all.filter((t) => FEATURED_CATEGORIES.includes(t.category));
  const hidden = all.filter((t) => !FEATURED_CATEGORIES.includes(t.category));
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = list[Math.min(index, list.length - 1)];
  const outline = chosen ? templateOutline(chosen) : [];
  const inputs = chosen ? templateInputs(chosen) : [];
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New playbook"
      description={PLAYBOOK_BLURB}
      className="procedure-gallery"
      initialFocus={listRef}
    >
      <div className="procedure-body">
        <div
          ref={listRef}
          className="procedure-list"
          role="listbox"
          aria-label="Playbook templates"
          aria-activedescendant={chosen ? `procedure-${chosen.id}` : undefined}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setIndex((i) => {
                const next = (i + step + list.length) % list.length;
                document.getElementById(`procedure-${list[next].id}`)?.scrollIntoView({ block: "nearest" });
                return next;
              });
            } else if (event.key === "Enter" && chosen) {
              event.preventDefault();
              onUse(chosen);
            }
          }}
        >
          {list.map((template, i) => (
            <Fragment key={template.id}>
            {(i === 0 || template.category !== list[i - 1].category) && (
              <div className="procedure-group" role="presentation">
                {categoryLabel(template.category)}
              </div>
            )}
            <div
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
            </Fragment>
          ))}
          {hidden.length > 0 && (
            <button
              type="button"
              className="procedure-more"
              aria-expanded={showAll}
              onClick={() => {
                setShowAll((v) => !v);
                listRef.current?.focus();
              }}
            >
              {showAll
                ? "Fewer templates"
                : `More templates — ${[...new Set(hidden.map((t) => categoryLabel(t.category)))].join(", ").toLowerCase()}`}
            </button>
          )}
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
                  <code key={param.name}>{labelOf(param)}</code>
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
