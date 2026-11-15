"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Check,
  CircleCheck,
  CircleHelp,
  Copy,
  CornerDownLeft,
  Flag,
  Globe,
  Link2,
  Loader2,
  ListChecks,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Send,
  Split,
  Square,
  X,
} from "lucide-react";
import { Modal } from "./ui/menu";
import { PageIcon } from "./page-icon";
import {
  OP_LABELS,
  STEP_LABELS,
  evaluate,
  interpolate,
  targetLabel,
  humanize,
  labelOf,
  shownValue,
  type Lookup,
  type Param,
  type Procedure,
  type RunState,
  type Step,
  type StepOutcome,
  type StepType,
  type ApiResponse,
} from "@/lib/runner";
import { buildRequest, isSecretHeader, maskSecret, prettyBody, urlProblem, type ApiRequest } from "@/lib/api-request";
import type { Page } from "@/lib/types";
import { useKeys, useTouchOnly } from "./keys";

export { humanize };

const STEP_ICONS: Record<StepType, typeof Check> = {
  send: MessageSquare,
  ask: CircleHelp,
  check: ListChecks,
  if: Split,
  api: Globe,
  end: Flag,
};

/**
 * An API step: shows exactly what will be sent (secrets masked), sends it only when
 * asked, then shows the answer and what was saved for later steps.
 */
function ApiCall({
  step,
  procedure,
  run,
  lookup,
  send,
  onAdvance,
}: {
  step: Step;
  procedure: Procedure;
  run: RunState;
  lookup?: Lookup;
  send: (request: ApiRequest) => Promise<ApiResponse>;
  onAdvance: (outcome: StepOutcome) => void;
}) {
  const request = buildRequest(step, procedure, run.vars, lookup);
  const problem = urlProblem(request.url, { allowPrivate: true });
  const [state, setState] = useState<{ sending: boolean; response?: ApiResponse }>({ sending: false });
  const sending = useRef(false);
  const fire = async () => {
    if (sending.current) return;
    sending.current = true;
    setState({ sending: true });
    const response = await send(request);
    sending.current = false;
    setState({ sending: false, response });
  };
  const response = state.response;
  // Keep the keyboard on the next thing to do (Send → Next, or Continue after a failure).
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    actionRef.current?.focus();
  }, [response]);
  return (
    <>
      <div className="run-request" aria-label="Request">
        <div className="run-request-line">
          <span className={`run-method is-${request.method.toLowerCase()}`}>{request.method}</span>
          <code>{request.url || "No URL yet"}</code>
        </div>
        {request.headers.length > 0 && (
          <dl className="run-request-headers">
            {request.headers.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{isSecretHeader(name) ? maskSecret(value) : value}</dd>
              </div>
            ))}
          </dl>
        )}
        {request.body && <pre className="run-request-body">{prettyBody(request.body)}</pre>}
      </div>
      {problem && !response && <p className="run-api-problem">{problem}</p>}
      {response && (
        <div className={`run-response ${response.ok ? "is-ok" : "is-failed"}`} role="status">
          <div className="run-response-head">
            <span className="run-status">
              {response.status ? response.status : "No response"}
              {response.ok ? " OK" : ""}
            </span>
            {response.ms !== undefined && <small>{response.ms} ms</small>}
            {response.ok && step.variable && (
              <small className="run-saved-as">
                Saved as <code>{`{{${step.variable}}}`}</code> and <code>{`{{${step.variable}_status}}`}</code>
              </small>
            )}
          </div>
          {response.error && <p>{response.error}</p>}
          {response.body && <pre>{prettyBody(response.body).slice(0, 4000)}</pre>}
        </div>
      )}
      <div className="run-card-actions">
        {!response ? (
          <button
            ref={actionRef}
            className="primary-button"
            aria-busy={state.sending}
            disabled={!!problem}
            onClick={fire}
          >
            {state.sending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
            {state.sending ? "Sending…" : "Send request"}
          </button>
        ) : response.ok ? (
          <button ref={actionRef} className="primary-button" onClick={() => onAdvance({ kind: "response", response })}>
            Next <CornerDownLeft size={14} className="key-hint" aria-hidden />
          </button>
        ) : (
          <>
            <button className="secondary-button" onClick={fire}>
              <RotateCcw size={14} /> Retry
            </button>
            <button
              ref={actionRef}
              className="primary-button"
              onClick={() => onAdvance({ kind: "response", response })}
            >
              Continue to {targetLabel(step.else)}
            </button>
          </>
        )}
      </div>
    </>
  );
}

export type RecordOption = { id: string; label: string };

/**
 * Asks for a run's inputs before it starts. Values can arrive prefilled (from a run
 * link or defaults); "Copy run link" shares a link that opens this form filled in.
 */
export function RunStartDialog({
  open,
  title,
  procedure,
  initial,
  recordOptions,
  onStart,
  onCopyLink,
  onClose,
  from,
}: {
  open: boolean;
  /** The section the run starts at, if not the beginning. */
  from?: string;
  title: string;
  procedure: Procedure;
  initial: Record<string, string>;
  recordOptions: (param: Param) => RecordOption[];
  onStart: (values: Record<string, string>) => void;
  onCopyLink: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [tried, setTried] = useState(false);
  const missing = procedure.params.filter((p) => p.required && !String(values[p.name] ?? "").trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!missing.length) onStart(values);
  };
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Run ${title || "Untitled"}`}
      description={
        (from ? `Starts at “${from}”. ` : "") +
        (procedure.params.length
          ? "Fill in the inputs this run needs. They're saved with the run."
          : "This run has no inputs.")
      }
      className="run-start"
    >
      <form onSubmit={submit} noValidate>
        <div className="run-fields">
          {procedure.params.map((param, index) => {
            const id = `run-param-${param.name}`;
            const value = values[param.name] ?? "";
            const invalid = tried && param.required && !value.trim();
            return (
              <div className={`run-field ${invalid ? "is-invalid" : ""}`} key={param.name}>
                <label htmlFor={id}>
                  {labelOf(param)}
                  {!param.required && <span>Optional</span>}
                </label>
                {param.type === "yesno" ? (
                  <div className="run-segment" role="radiogroup" aria-labelledby={id}>
                    {["Yes", "No"].map((option) => (
                      <button
                        type="button"
                        key={option}
                        role="radio"
                        aria-checked={value === option}
                        className={value === option ? "is-active" : ""}
                        onClick={() => set(param.name, option)}
                      >
                        {option}
                      </button>
                    ))}
                    <input id={id} type="hidden" value={value} />
                  </div>
                ) : param.type === "choice" || param.type === "record" ? (
                  <select
                    id={id}
                    autoFocus={index === 0}
                    value={value}
                    aria-invalid={invalid}
                    onChange={(event) => set(param.name, event.target.value)}
                  >
                    <option value="">Choose…</option>
                    {(param.type === "record"
                      ? recordOptions(param)
                      : (param.options || []).filter(Boolean).map((o) => ({ id: o.trim(), label: o.trim() }))
                    ).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    autoFocus={index === 0}
                    type={
                      param.type === "number"
                        ? "number"
                        : param.type === "date"
                          ? "date"
                          : param.type === "secret"
                            ? "password"
                            : "text"
                    }
                    autoComplete={param.type === "secret" ? "off" : undefined}
                    value={value}
                    aria-invalid={invalid}
                    onChange={(event) => set(param.name, event.target.value)}
                  />
                )}
                {param.type === "secret" && !invalid && (
                  <small className="run-field-hint">Hidden, and never shown in run history or run links.</small>
                )}
                {invalid && <small role="alert">{labelOf(param)} is required</small>}
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button type="button" className="run-link-button" onClick={() => onCopyLink(values)}>
            <Link2 size={15} />
            Copy run link
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" autoFocus={!procedure.params.length}>
            <Play size={14} />
            Start run
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** How a step reads in the outline: its text with values filled in. */
function outlineText(step: Step, procedure: Procedure, run: RunState, lookup?: Lookup) {
  if (step.text) return interpolate(step.text, procedure, run.vars, lookup);
  if (step.step === "if" && step.variable)
    return `If ${humanize(step.variable.replace(/\./g, " → ")).toLowerCase()} ${OP_LABELS[step.op || "is"]}${step.value ? ` ${step.value}` : ""}`;
  return STEP_LABELS[step.step];
}

function Outline({ procedure, run, lookup }: { procedure: Procedure; run: RunState; lookup?: Lookup }) {
  const groups: { title: string; steps: Step[] }[] = [];
  for (const step of procedure.steps) {
    const title = step.section >= 0 ? procedure.sections[step.section] : "Start";
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.steps.push(step);
    else groups.push({ title, steps: [step] });
  }
  const done = new Set(run.trail);
  const furthest = Math.max(-1, ...run.trail);
  return (
    <nav className="run-outline" aria-label="Run steps">
      {groups.map((group, g) => (
        <div key={g} className="run-outline-group">
          <div className="run-outline-title">{group.title}</div>
          <ol>
            {group.steps.map((step) => {
              const current = step.index === run.step;
              const state = current
                ? "is-current"
                : done.has(step.index)
                  ? "is-done"
                  : step.index < furthest
                    ? "is-skipped"
                    : "";
              return (
                <li key={step.index} className={state} aria-current={current ? "step" : undefined}>
                  <span className="run-dot" aria-hidden>
                    {done.has(step.index) && !current ? <Check size={11} /> : null}
                  </span>
                  <span className="run-outline-text">{outlineText(step, procedure, run, lookup)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </nav>
  );
}

function StepCard({
  procedure,
  run,
  lookup,
  onAdvance,
  send,
}: {
  procedure: Procedure;
  run: RunState;
  lookup?: Lookup;
  onAdvance: (outcome: StepOutcome) => void;
  send: (request: ApiRequest) => Promise<ApiResponse>;
}) {
  const step = procedure.steps[run.step];
  const fill = (text: string) => interpolate(text, procedure, run.vars, lookup);
  const [answer, setAnswer] = useState(step?.variable ? (run.vars[step.variable] ?? "") : "");
  const [copied, setCopied] = useState(false);
  if (!step) return null;
  const Icon = STEP_ICONS[step.step];
  const text = fill(step.text);
  let body: ReactNode = null;
  let primary: ReactNode = (
    <button className="primary-button" autoFocus onClick={() => onAdvance({ kind: "next" })}>
      Next <CornerDownLeft size={14} className="key-hint" aria-hidden />
    </button>
  );
  if (step.step === "send") {
    body = text ? (
      <button
        className="run-copy"
        onClick={async () => {
          await navigator.clipboard?.writeText(text).catch(() => undefined);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy text"}
      </button>
    ) : null;
  }
  if (step.step === "ask") {
    const options =
      step.answer === "yesno"
        ? ["Yes", "No"]
        : step.answer === "choice"
          ? (step.options || "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : null;
    if (options) {
      body = (
        <div className="run-choices" role="group" aria-label="Answer">
          {options.map((option, i) => (
            <button
              key={option}
              autoFocus={i === 0}
              className={answer === option ? "is-active" : ""}
              onClick={() => onAdvance({ kind: "answer", value: option })}
            >
              {option}
            </button>
          ))}
        </div>
      );
      primary = null;
    } else {
      const formId = `run-answer-${step.index}`;
      body = (
        <form
          id={formId}
          className="run-answer"
          onSubmit={(event) => {
            event.preventDefault();
            onAdvance({ kind: "answer", value: answer.trim() });
          }}
        >
          <input
            autoFocus
            aria-label="Answer"
            type={step.answer === "number" ? "number" : "text"}
            placeholder="Type the answer…"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          {step.variable && <small>Saved as {`{{${step.variable}}}`}</small>}
        </form>
      );
      primary = (
        <button className="primary-button" type="submit" form={formId}>
          Next <CornerDownLeft size={14} className="key-hint" aria-hidden />
        </button>
      );
    }
  }
  if (step.step === "check") {
    body = step.expected ? (
      <div className="run-expected">
        <span>Expected</span>
        {fill(step.expected)}
      </div>
    ) : null;
    primary = (
      <div className="run-check-actions">
        <button className="secondary-button" onClick={() => onAdvance({ kind: "check", result: "skipped" })}>
          Skip
        </button>
        <button
          className="secondary-button is-danger"
          title={step.else ? `Goes to ${targetLabel(step.else)}` : undefined}
          onClick={() => onAdvance({ kind: "check", result: "failed" })}
        >
          <X size={14} /> Failed
        </button>
        <button className="primary-button" autoFocus onClick={() => onAdvance({ kind: "check", result: "passed" })}>
          <Check size={14} /> Passed
        </button>
      </div>
    );
  }
  if (step.step === "if") {
    const { holds, reason } = evaluate(step, procedure, run.vars, lookup);
    const target = holds ? step.then : step.else;
    body = (
      <div className={`run-decision ${holds ? "is-yes" : "is-no"}`}>
        <strong>{holds ? "Yes" : "No"}</strong> — {reason}.
        <span>
          Going to <b>{targetLabel(target)}</b>.
        </span>
      </div>
    );
    primary = (
      <button className="primary-button" autoFocus onClick={() => onAdvance({ kind: "next" })}>
        Continue <CornerDownLeft size={14} className="key-hint" aria-hidden />
      </button>
    );
  }
  if (step.step === "api") {
    body = <ApiCall step={step} procedure={procedure} run={run} lookup={lookup} send={send} onAdvance={onAdvance} />;
    primary = null;
  }
  if (step.step === "end")
    primary = (
      <button className="primary-button" autoFocus onClick={() => onAdvance({ kind: "next" })}>
        <CircleCheck size={15} /> Finish run
      </button>
    );
  return (
    <div className={`run-card is-${step.step}`}>
      <div className="run-card-kind">
        <Icon size={15} />
        {STEP_LABELS[step.step]}
        <span>
          Step {step.index + 1} of {procedure.steps.length}
        </span>
      </div>
      <p className="run-card-text">
        {text ||
          (step.step === "end"
            ? "That's the end of this run."
            : step.step === "api"
              ? "Call the API"
              : STEP_LABELS[step.step])}
      </p>
      {body}
      {primary && <div className="run-card-actions">{primary}</div>}
    </div>
  );
}

/** The run, played back one step at a time over the whole window. */
export function RunView({
  open,
  page,
  procedure,
  run,
  lookup,
  onAdvance,
  onBack,
  onPause,
  onStop,
  onRunAgain,
  onOpenLog,
  sendRequest,
}: {
  open: boolean;
  page: Pick<Page, "title" | "icon" | "kind">;
  procedure: Procedure;
  run: RunState;
  lookup?: Lookup;
  onAdvance: (outcome: StepOutcome) => void;
  onBack: () => void;
  onPause: () => void;
  onStop: () => void;
  onRunAgain: () => void;
  onOpenLog: () => void;
  sendRequest: (request: ApiRequest) => Promise<ApiResponse>;
}) {
  const shortcut = useKeys();
  const touchOnly = useTouchOnly();
  const finished = run.status !== "running";
  const started = useRef(new Date());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (finished) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - started.current.getTime()), 1000);
    return () => window.clearInterval(timer);
  }, [finished]);
  const minutes = Math.floor(elapsed / 60000);
  const passed = run.log.filter((e) => e.result === "Passed").length;
  const failed = run.log.filter((e) => e.result === "Failed").length;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onPause()}>
      <Dialog.Portal>
        <Dialog.Content
          className="run-surface"
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.altKey && event.key === "ArrowLeft") {
              event.preventDefault();
              onBack();
            }
          }}
        >
          <header className="run-header">
            <PageIcon page={page} size={20} />
            <Dialog.Title className="run-title">{page.title || "Untitled"}</Dialog.Title>
            <div className="run-inputs">
              {procedure.params.map((param) => {
                const value = shownValue(procedure, run.vars, param.name, lookup);
                return value ? (
                  <span key={param.name} className="run-input-chip" title={labelOf(param)}>
                    <small>{labelOf(param)}</small>
                    {value}
                  </span>
                ) : null;
              })}
            </div>
            {!finished && (
              <span className="run-time" aria-label="Time running">
                {minutes < 1 ? "Just started" : `${minutes} min`}
              </span>
            )}
            {!finished && (
              <>
                <button className="run-header-button" onClick={onPause} title="Pause (Esc) — pick it up later">
                  <Pause size={15} /> Pause
                </button>
                <button className="run-header-button" onClick={onStop} title="Stop this run">
                  <Square size={13} /> Stop
                </button>
              </>
            )}
            {finished && (
              <Dialog.Close className="run-header-button" aria-label="Close">
                <X size={16} />
              </Dialog.Close>
            )}
          </header>
          <div className="run-progress" aria-hidden>
            <span
              style={{
                width: `${finished ? 100 : Math.round((run.step / Math.max(1, procedure.steps.length)) * 100)}%`,
              }}
            />
          </div>
          <div className="run-body">
            <Outline procedure={procedure} run={run} lookup={lookup} />
            <main className="run-main">
              {finished ? (
                <div className="run-card is-summary">
                  <div className={`run-summary-icon ${run.status === "stopped" ? "is-stopped" : ""}`}>
                    {run.status === "stopped" ? <Square size={22} /> : <CircleCheck size={26} />}
                  </div>
                  <h2>{run.status === "stopped" ? "Run stopped" : "Run complete"}</h2>
                  <p className="run-summary-text">
                    {run.trail.length} {run.trail.length === 1 ? "step" : "steps"}
                    {passed + failed > 0 && ` · ${passed} passed`}
                    {failed > 0 && ` · ${failed} failed`}
                    {` · ${minutes < 1 ? "under a minute" : `${minutes} min`}`}
                  </p>
                  <div className="run-card-actions is-centered">
                    <button className="secondary-button" onClick={onOpenLog}>
                      Open run log
                    </button>
                    <button className="secondary-button" onClick={onRunAgain}>
                      <RotateCcw size={14} /> Run again
                    </button>
                    <Dialog.Close className="primary-button" autoFocus>
                      Done
                    </Dialog.Close>
                  </div>
                </div>
              ) : (
                <StepCard
                  key={`${run.step}-${run.trail.length}`}
                  procedure={procedure}
                  run={run}
                  lookup={lookup}
                  onAdvance={onAdvance}
                  send={sendRequest}
                />
              )}
              {!finished && (
                <div className="run-footer">
                  <button
                    className="run-back"
                    onClick={onBack}
                    disabled={!run.trail.length}
                    title={shortcut.withKeys("Back", "Alt+ArrowLeft")}
                  >
                    <ArrowLeft size={15} /> Back
                  </button>
                  {!touchOnly && (
                    <span className="run-hint">
                      <kbd>↵</kbd> continue · <kbd>{shortcut.keys("Alt+ArrowLeft")}</kbd> back · <kbd>esc</kbd> pause
                    </span>
                  )}
                </div>
              )}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
