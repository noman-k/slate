/**
 * Running a playbook or runbook, one step at a time.
 *
 * A runnable page holds a Parameters block (its typed inputs) and step blocks — Send,
 * Ask, Check, If / Else, End — grouped into sections by its ## headings. Both are saved in
 * the page's Markdown as `:::slate-node` lines, so this module reads them straight from
 * the Markdown, with no editor needed. Values are kept as strings, the way they're typed.
 */
import { splitMarkdown } from "./markdown";

export type ParamType = "text" | "number" | "date" | "yesno" | "choice" | "record";
export interface Param {
  /** The key used in {{…}}; made from the label and kept stable once steps use it. */
  name: string;
  /** What people see, e.g. "Order number". */
  label?: string;
  type: ParamType;
  required: boolean;
  default?: string;
  /** Choices for a "choice" parameter. */
  options?: string[];
  /** The database a "record" parameter picks from. */
  databaseId?: string;
}

export type StepType = "send" | "ask" | "check" | "if" | "api" | "end";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AnswerType = "text" | "number" | "yesno" | "choice";
export type ConditionOp = "is" | "is_not" | "contains" | "gt" | "lt" | "set" | "not_set";

/** Where a branch goes: "" the next step, "@end" finish, or a section's title. */
export type Target = string;
export const NEXT: Target = "";
export const END: Target = "@end";

export interface StepAttrs {
  step: StepType;
  /** Ask: the variable the answer is saved as. If: the variable that's checked. */
  variable?: string;
  answer?: AnswerType;
  /** Ask (choice): the answers to pick from, comma-separated. */
  options?: string;
  /** Check: what you should see when it worked. */
  expected?: string;
  op?: ConditionOp;
  value?: string;
  /** If: where to go when the condition holds. */
  then?: Target;
  /** If: where to go otherwise. Check and API: where to go when it fails. */
  else?: Target;
  /** API: the request. URL, headers and body can use {{values}}. */
  method?: HttpMethod;
  url?: string;
  /** API: one "Name: value" per line. */
  headers?: string;
  body?: string;
}

export interface Step extends StepAttrs {
  index: number;
  /** Index into `sections`, or -1 before the first heading. */
  section: number;
  text: string;
}
export interface Procedure {
  params: Param[];
  sections: string[];
  steps: Step[];
}

/** Step names in plain words (the stored keys stay send / ask / check / if / api / end). */
export const STEP_LABELS: Record<StepType, string> = {
  send: "Say",
  ask: "Ask",
  check: "Check",
  if: "Decide",
  api: "Call",
  end: "Finish",
};
export const OP_LABELS: Record<ConditionOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  gt: "is more than",
  lt: "is less than",
  set: "has a value",
  not_set: "is empty",
};

/** "amount_due" → "Amount due". */
export const humanize = (name: string) => {
  const text = name.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
/** "Order number" → "order_number": a key that can go in {{…}}. */
export const keyFor = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1");
/** What an input is called on screen. */
export const labelOf = (param: Param) => param.label?.trim() || humanize(param.name);

/**
 * Every value a step can use, with a friendly name: inputs, answers to Ask steps, and
 * responses (and their status codes) from Call steps.
 */
export function valuesOf(p: Pick<Procedure, "params" | "steps">) {
  const values: { key: string; label: string; kind: "input" | "answer" | "response" | "status" }[] = [];
  const add = (key: string, label: string, kind: (typeof values)[number]["kind"]) => {
    if (key && !values.some((v) => v.key === key)) values.push({ key, label, kind });
  };
  for (const param of p.params) add(param.name, labelOf(param), "input");
  for (const step of p.steps) {
    if (step.step === "ask" && step.variable) add(step.variable, humanize(step.variable), "answer");
    if (step.step === "api" && step.variable) {
      add(step.variable, `${humanize(step.variable)} (response)`, "response");
      add(`${step.variable}_status`, `${humanize(step.variable)} status code`, "status");
    }
  }
  return values;
}

type JsonNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: JsonNode[] };
const textOf = (node: JsonNode): string =>
  node.text ?? (node.content || []).map(textOf).join("");

/** Reads a page's Markdown into its parameters, sections and steps. */
export function parseProcedure(markdown: string): Procedure {
  const procedure: Procedure = { params: [], sections: [], steps: [] };
  for (const part of splitMarkdown(markdown)) {
    if (part.kind === "markdown") {
      let fenced = false;
      for (const line of part.source.split("\n")) {
        if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
        const heading = !fenced && /^#{1,2}\s+(.+?)\s*#*$/.exec(line);
        if (heading) procedure.sections.push(heading[1].trim());
      }
    } else if (part.kind === "rich") {
      const node = part.node as JsonNode;
      if (node.type === "procedureParams" && !procedure.params.length)
        procedure.params = ((node.attrs?.params as Param[]) || []).filter((p) => p.name);
      if (node.type === "procedureStep") {
        const attrs = (node.attrs || {}) as unknown as StepAttrs;
        procedure.steps.push({
          ...attrs,
          step: attrs.step || "send",
          index: procedure.steps.length,
          section: procedure.sections.length - 1,
          text: textOf(node).trim(),
        });
      }
    }
  }
  return procedure;
}

export const isRunnable = (p: Procedure) => p.steps.length > 0;

/** Every variable a run can have: parameters, then answers to Ask steps. */
export function variablesOf(p: Procedure) {
  return valuesOf(p).map((value) => value.key);
}

/** `{{name}}` and `{{name.Property}}` references in a text. */
export const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][\w]*)(?:\.([^}]+?))?\s*\}\}/g;

/**
 * How a value reads. A record parameter holds a record id; `lookup` turns it (and an
 * optional property name) into text. Anything else reads as itself.
 */
export type Lookup = (param: Param, value: string, property?: string) => string;

export function displayValue(
  p: Procedure,
  vars: Record<string, string>,
  name: string,
  lookup?: Lookup,
  property?: string,
) {
  const value = vars[name] ?? "";
  const param = p.params.find((item) => item.name === name);
  if (param?.type === "record" && value && lookup) return lookup(param, value, property);
  if (property) return readPath(value, property);
  return value;
}

/**
 * A field inside a JSON value, e.g. "customer.email" or "items.0.name" (an API
 * response). Objects and lists read as compact JSON; anything missing reads as "".
 */
export function readPath(json: string, path: string) {
  let current: unknown;
  try {
    current = JSON.parse(json);
  } catch {
    return "";
  }
  for (const key of path.split(".").filter(Boolean)) {
    if (current === null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  if (current === undefined || current === null) return "";
  return typeof current === "object" ? JSON.stringify(current) : String(current);
}

/** "order.total" → the "order" variable's "total" field. */
const splitName = (name: string): [string, string | undefined] => {
  const dot = name.indexOf(".");
  return dot < 0 ? [name, undefined] : [name.slice(0, dot), name.slice(dot + 1)];
};

/** Fills in `{{…}}` references; unknown or empty ones stay visible as "{{name}}". */
export function interpolate(
  text: string,
  p: Procedure,
  vars: Record<string, string>,
  lookup?: Lookup,
  /** How a value is written into the text: as-is, URL-encoded, or escaped for JSON. */
  escape: "none" | "url" | "json" = "none",
) {
  return text.replace(VARIABLE_PATTERN, (match, name: string, property?: string) => {
    const value = displayValue(p, vars, name, lookup, property?.trim());
    if (escape === "none") return value === "" ? match : value;
    if (escape === "url") return encodeURIComponent(value);
    return JSON.stringify(value).slice(1, -1);
  });
}

/** Whether an If step's condition holds, and a sentence saying why. */
export function evaluate(
  step: Step,
  p: Procedure,
  vars: Record<string, string>,
  lookup?: Lookup,
): { holds: boolean; reason: string } {
  const name = step.variable || "";
  const [base, path] = splitName(name);
  const actual = displayValue(p, vars, base, lookup, path);
  const expected = interpolate(step.value || "", p, vars, lookup);
  const op = step.op || "is";
  const a = actual.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  const num = (s: string) => Number.parseFloat(s.replace(/[^0-9.-]/g, ""));
  let holds = false;
  if (op === "is") holds = a === b;
  else if (op === "is_not") holds = a !== b;
  else if (op === "contains") holds = !!b && a.includes(b);
  else if (op === "gt") holds = num(actual) > num(expected);
  else if (op === "lt") holds = num(actual) < num(expected);
  else if (op === "set") holds = a !== "";
  else if (op === "not_set") holds = a === "";
  const shown = actual === "" ? "empty" : `“${actual}”`;
  const label = humanize(name.replace(/\./g, " → "));
  const reason =
    op === "set" || op === "not_set"
      ? `${label || "The value"} ${actual === "" ? "is empty" : "has a value"}`
      : `${label || "The value"} is ${shown}, so “${OP_LABELS[op]} ${expected}” is ${holds ? "true" : "false"}`;
  return { holds, reason };
}

export interface LogEntry {
  step: number;
  /** What happened, e.g. "Yes", "Passed", "Went to Escalate". */
  result?: string;
  at: string;
}
export type RunStatus = "running" | "done" | "stopped";
export interface RunState {
  /** The step being shown; -1 once the run has finished. */
  step: number;
  vars: Record<string, string>;
  /** Steps shown so far, for Back. */
  trail: number[];
  log: LogEntry[];
  status: RunStatus;
}

/** The first step of a section, or -1 if it has none. */
function firstStepIn(p: Procedure, title: string) {
  const section = p.sections.findIndex((s) => s.toLowerCase() === title.toLowerCase());
  return p.steps.find((s) => s.section === section && section >= 0)?.index ?? -1;
}
function resolveTarget(p: Procedure, from: number, target: Target | undefined) {
  if (!target) return from + 1 < p.steps.length ? from + 1 : -1;
  if (target === END) return -1;
  const index = firstStepIn(p, target);
  return index >= 0 ? index : from + 1 < p.steps.length ? from + 1 : -1;
}
export function targetLabel(target: Target | undefined) {
  if (!target) return "the next step";
  if (target === END) return "the finish";
  return `“${target}”`;
}

/** Starts a run at the first step, or at the first step of section `from`. */
export function startRun(p: Procedure, values: Record<string, string>, from?: string): RunState {
  const vars: Record<string, string> = {};
  for (const param of p.params) vars[param.name] = values[param.name] ?? param.default ?? "";
  const first = from ? firstStepIn(p, from) : 0;
  return {
    step: p.steps.length ? Math.max(0, first) : -1,
    vars,
    trail: [],
    log: [],
    status: p.steps.length ? "running" : "done",
  };
}

export type StepOutcome =
  | { kind: "next" }
  | { kind: "answer"; value: string }
  | { kind: "check"; result: "passed" | "failed" | "skipped" }
  | { kind: "response"; response: ApiResponse };

export interface ApiResponse {
  /** 0 when the request never got an answer (network error, blocked, timed out). */
  status: number;
  ok: boolean;
  body: string;
  /** Why it failed, in words, when there's no useful status. */
  error?: string;
  ms?: number;
}
/** Responses are kept with the run; very large ones are cut down. */
export const MAX_SAVED_BODY = 20_000;

/** Completes the current step and moves to whichever step comes next. */
export function advance(
  p: Procedure,
  state: RunState,
  outcome: StepOutcome,
  lookup?: Lookup,
  now = new Date(),
): RunState {
  const step = p.steps[state.step];
  if (!step || state.status !== "running") return state;
  const vars = { ...state.vars };
  let next = resolveTarget(p, step.index, NEXT);
  let result: string | undefined;
  if (step.step === "ask" && outcome.kind === "answer") {
    if (step.variable) vars[step.variable] = outcome.value;
    result = outcome.value || "(no answer)";
  } else if (step.step === "check" && outcome.kind === "check") {
    result = outcome.result[0].toUpperCase() + outcome.result.slice(1);
    if (outcome.result === "failed") next = resolveTarget(p, step.index, step.else);
  } else if (step.step === "if") {
    const { holds } = evaluate(step, p, vars, lookup);
    const target = holds ? step.then : step.else;
    next = resolveTarget(p, step.index, target);
    result = `${holds ? "Yes" : "No"} → ${targetLabel(target)}`;
  } else if (step.step === "api" && outcome.kind === "response") {
    const { response } = outcome;
    if (step.variable) {
      vars[step.variable] = response.body.slice(0, MAX_SAVED_BODY);
      vars[`${step.variable}_status`] = String(response.status || "");
    }
    result = response.ok
      ? `${response.status} OK`
      : response.status
        ? `Failed: ${response.status}`
        : `Failed: ${response.error || "no response"}`;
    if (!response.ok) next = resolveTarget(p, step.index, step.else);
  } else if (step.step === "end") {
    next = -1;
  }
  return {
    step: next,
    vars,
    trail: [...state.trail, step.index],
    log: [...state.log, { step: step.index, result, at: now.toISOString() }],
    status: next === -1 ? "done" : "running",
  };
}

/** Goes back to the previous step shown (its answer can be changed). */
export function back(state: RunState): RunState {
  if (!state.trail.length) return state;
  const previous = state.trail[state.trail.length - 1];
  return {
    ...state,
    step: previous,
    trail: state.trail.slice(0, -1),
    log: state.log.slice(0, -1),
    status: "running",
  };
}

/** A readable record of the run, for the run's own page. */
export function runLogMarkdown(p: Procedure, state: RunState, lookup?: Lookup) {
  const lines: string[] = [];
  if (p.params.length) {
    lines.push("## Inputs", "");
    for (const param of p.params)
      lines.push(`- **${labelOf(param)}:** ${displayValue(p, state.vars, param.name, lookup) || "—"}`);
    lines.push("");
  }
  lines.push("## Steps", "");
  for (const entry of state.log) {
    const step = p.steps[entry.step];
    if (!step) continue;
    const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = interpolate(step.text, p, state.vars, lookup) || STEP_LABELS[step.step];
    lines.push(`- ${time} · **${STEP_LABELS[step.step]}** ${text}${entry.result ? ` → ${entry.result}` : ""}`);
  }
  if (state.status === "stopped") lines.push("", "_Stopped before the end._");
  return lines.join("\n") + "\n";
}
