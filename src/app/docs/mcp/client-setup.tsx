"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy } from "lucide-react";

/** A copy button for a value or code block; says "Copied" for a moment. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      className="docs-copy"
      aria-label={copied ? "Copied" : label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** A code block with a caption (file name or "Terminal") and a copy button. */
export function CodeBlock({ code, caption }: { code: string; caption?: string }) {
  return (
    <figure className="docs-code">
      <figcaption>
        <span>{caption}</span>
        <CopyButton value={code} label={caption ? `Copy ${caption}` : "Copy code"} />
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/** Text with `inline code` in backticks and **menu names** in bold. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

export interface ClientGuide {
  id: string;
  name: string;
  steps: { text: string; code?: string; caption?: string }[];
  note?: string;
}

const STORAGE_KEY = "slate-docs-mcp-client";

/** One tab per client; remembers the last one picked on this device. */
export function ClientSetup({ guides }: { guides: ClientGuide[] }) {
  const [active, setActive] = useState(guides[0].id);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && guides.some((g) => g.id === saved)) queueMicrotask(() => setActive(saved));
    } catch {}
  }, [guides]);
  const choose = (id: string) => {
    setActive(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  };
  // Arrow keys move between tabs, as in any tab list.
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = guides.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    choose(guides[next].id);
    tabs.current[next]?.focus();
  };
  return (
    <div className="docs-clients">
      <div className="docs-tabs" role="tablist" aria-label="AI client">
        {guides.map((guide, index) => (
          <button
            key={guide.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`client-tab-${guide.id}`}
            aria-selected={active === guide.id}
            aria-controls={`client-panel-${guide.id}`}
            tabIndex={active === guide.id ? 0 : -1}
            onClick={() => choose(guide.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {guide.name}
          </button>
        ))}
      </div>
      {guides.map((guide) => (
        <div
          key={guide.id}
          role="tabpanel"
          id={`client-panel-${guide.id}`}
          aria-labelledby={`client-tab-${guide.id}`}
          hidden={active !== guide.id}
          className="docs-panel"
        >
          <ol className="docs-steps">
            {guide.steps.map((step, index) => (
              <li key={index}>
                <p><Inline text={step.text} /></p>
                {step.code && <CodeBlock code={step.code} caption={step.caption} />}
              </li>
            ))}
          </ol>
          {guide.note && <p className="docs-note"><Inline text={guide.note} /></p>}
        </div>
      ))}
    </div>
  );
}

/** "On this page": marks the section being read (the last heading scrolled past). */
export function TableOfContents({ sections }: { sections: readonly (readonly [string, string])[] }) {
  const [current, setCurrent] = useState<string>(sections[0][0]);
  useEffect(() => {
    const update = () => {
      let id = sections[0][0];
      for (const [sectionId] of sections) {
        const el = document.getElementById(sectionId);
        if (el && el.getBoundingClientRect().top <= 120) id = sectionId;
      }
      // At the very bottom, the last section counts even if its heading never reached the top.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = sections[sections.length - 1][0];
      setCurrent(id);
    };
    update();
    // Opening the page at #section scrolls after the first render: check again then.
    const settle = window.setTimeout(update, 150);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("hashchange", update);
    };
  }, [sections]);
  return (
    <nav className="docs-toc" aria-label="On this page">
      <p>On this page</p>
      <ol>
        {sections.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={current === id ? "location" : undefined}>{label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
