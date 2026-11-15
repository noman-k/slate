/**
 * The playbook builder's model of a runnable page, and the way back to Markdown.
 *
 * A playbook page is stored the same way as before — a details table, an Inputs block,
 * a "Guidelines" list, then one "## heading" per section followed by its step blocks —
 * so runs, run links, templates and "View as Markdown" keep working. The builder edits
 * this model instead of free text; anything that doesn't fit the model is kept as Notes
 * rather than lost.
 */
import { splitMarkdown } from "./markdown";
import type { Param, StepAttrs } from "./runner";
import { id } from "./utils";

export type StepContent = { type?: string; text?: string; marks?: unknown[]; attrs?: Record<string, unknown> }[];
export interface BuilderStep {
  id: string;
  attrs: StepAttrs & Record<string, unknown>;
  /** Inline content as saved: text with {{values}}, maybe with marks. */
  content: StepContent;
}
export interface BuilderSection {
  id: string;
  title: string;
  /** A short line under the title (optional). */
  description: string;
  steps: BuilderStep[];
}
export interface RunbookDetails {
  owner: string;
  time: string;
  lastReviewed: string;
  reviewEvery: string;
}
export interface PlaybookModel {
  details: RunbookDetails | null;
  params: Param[];
  guidelines: string[];
  sections: BuilderSection[];
  /** Markdown that isn't part of the structure, kept as it was. */
  notes: string;
}

const DETAILS_HEADER = ["owner", "time needed", "last reviewed", "review every"];
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/** The runbook details table ("| Owner | Time needed | Last reviewed | Review every |"). */
function readDetails(source: string): { details: RunbookDetails; rest: string } | null {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith("|"));
  if (start < 0 || lines.slice(0, start).some((line) => line.trim())) return null;
  const header = cells(lines[start]).map((cell) => cell.toLowerCase());
  if (DETAILS_HEADER.some((name, i) => header[i] !== name)) return null;
  if (!/^\s*\|?\s*:?-{3,}/.test(lines[start + 1] || "")) return null;
  const row = cells(lines[start + 2] || "");
  if (!(lines[start + 2] || "").trim().startsWith("|")) return null;
  return {
    details: { owner: row[0] || "", time: row[1] || "", lastReviewed: row[2] || "", reviewEvery: row[3] || "" },
    rest: lines.slice(start + 3).join("\n"),
  };
}

const textOf = (content: StepContent) => content.map((part) => part.text || "").join("");

export function parsePlaybook(markdown: string): PlaybookModel {
  const model: PlaybookModel = { details: null, params: [], guidelines: [], sections: [], notes: "" };
  const notes: string[] = [];
  let section: BuilderSection | null = null;
  let inGuidelines = false;
  let first = true;
  const addNote = (text: string) => {
    if (text.trim()) notes.push(text.trim());
  };
  const startSection = (title: string) => {
    section = { id: id(), title, description: "", steps: [] };
    model.sections.push(section);
  };
  for (const part of splitMarkdown(markdown)) {
    if (part.kind === "markdown") {
      let source = part.source;
      if (first) {
        const found = readDetails(source);
        if (found) {
          model.details = found.details;
          source = found.rest;
        }
      }
      first = false;
      // Walk the text line by line: headings start sections, Guidelines collects
      // bullets, a section's first plain line is its description, the rest are notes.
      let pending: string[] = [];
      const flush = () => {
        const text = pending.join("\n").trim();
        pending = [];
        if (!text) return;
        const current = section as BuilderSection | null;
        if (current && !current.steps.length && !current.description && !text.includes("\n") && !/^[-*#>|`]/.test(text))
          current.description = text;
        else addNote(current ? `## ${current.title}\n\n${text}` : text);
      };
      let fenced = false;
      for (const line of source.split("\n")) {
        if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
        const heading = !fenced && /^#{1,2}\s+(.+?)\s*#*$/.exec(line);
        if (heading) {
          flush();
          const title = heading[1].trim();
          inGuidelines = /^guidelines$/i.test(title);
          if (inGuidelines) section = null;
          else startSection(title);
          continue;
        }
        if (inGuidelines) {
          const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
          if (bullet) model.guidelines.push(bullet[1].trim());
          else if (line.trim()) model.guidelines.push(line.trim());
          continue;
        }
        pending.push(line);
      }
      flush();
    } else if (part.kind === "rich") {
      first = false;
      const node = part.node as { type?: string; attrs?: Record<string, unknown>; content?: StepContent };
      if (node.type === "procedureParams" && !model.params.length) {
        model.params = ((node.attrs?.params as Param[]) || []).map((param) => ({ ...param }));
        continue;
      }
      if (node.type === "procedureStep") {
        inGuidelines = false;
        if (!section) startSection(model.sections.length ? "More steps" : "Steps");
        (section as unknown as BuilderSection).steps.push({
          id: id(),
          attrs: { step: "send", ...(node.attrs || {}) } as BuilderStep["attrs"],
          content: (node.content || []).map((piece) => ({ ...piece })),
        });
        continue;
      }
      addNote(part.source);
    } else {
      first = false;
      addNote(part.source);
    }
  }
  model.notes = notes.join("\n\n");
  return model;
}

/** Only the settings in use, like the editor saves them. */
const compactAttrs = (attrs: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value !== null && value !== undefined && value !== ""),
  );

export function stepLine(step: Pick<BuilderStep, "attrs" | "content">) {
  const content = step.content.filter((piece) => piece.type !== "text" || piece.text);
  return `:::slate-node ${JSON.stringify({
    type: "procedureStep",
    attrs: compactAttrs(step.attrs),
    ...(content.length ? { content } : {}),
  })}`;
}

export function serializePlaybook(model: PlaybookModel): string {
  const blocks: string[] = [];
  if (model.details) {
    const d = model.details;
    const clean = (value: string) => value.replace(/\|/g, "/").trim() || "—";
    blocks.push(
      `| Owner | Time needed | Last reviewed | Review every |\n| --- | --- | --- | --- |\n| ${clean(d.owner)} | ${clean(d.time)} | ${clean(d.lastReviewed)} | ${clean(d.reviewEvery)} |`,
    );
  }
  if (model.params.length)
    blocks.push(`:::slate-node ${JSON.stringify({ type: "procedureParams", attrs: { params: model.params } })}`);
  const guidelines = model.guidelines.map((line) => line.trim()).filter(Boolean);
  if (guidelines.length) blocks.push("## Guidelines", guidelines.map((line) => `- ${line}`).join("\n"));
  for (const section of model.sections) {
    blocks.push(`## ${section.title.replace(/\n/g, " ").trim() || "Untitled section"}`);
    if (section.description.trim()) blocks.push(section.description.replace(/\n/g, " ").trim());
    for (const step of section.steps) blocks.push(stepLine(step));
  }
  if (model.notes.trim()) blocks.push(model.notes.trim());
  return blocks.join("\n\n") + "\n";
}

/** A new, empty step of a type, with sensible defaults. */
export function newStep(type: StepAttrs["step"]): BuilderStep {
  return {
    id: id(),
    attrs: {
      step: type,
      ...(type === "ask" ? { answer: "text" } : {}),
      ...(type === "if" ? { op: "is" } : {}),
      ...(type === "api" ? { method: "GET" } : {}),
    } as BuilderStep["attrs"],
    content: [],
  };
}

/**
 * Renames a value everywhere in the model: {{old}} / {{old.field}} / {{old_status}} in
 * step text and settings, and Decide steps that check it.
 */
export function renameInModel(model: PlaybookModel, from: string, to: string): PlaybookModel {
  if (!from || !to || from === to) return model;
  const pattern = new RegExp(`\\{\\{(\\s*)${from}((?:_status)?)(?=[\\s.}])`, "g");
  const swap = (text: string) =>
    text.replace(pattern, (_m, space: string, suffix: string) => `{{${space}${to}${suffix}`);
  return {
    ...model,
    sections: model.sections.map((section) => ({
      ...section,
      description: swap(section.description),
      steps: section.steps.map((step) => {
        const attrs = { ...step.attrs };
        for (const key of ["url", "headers", "body", "value", "expected"] as const)
          if (typeof attrs[key] === "string") attrs[key] = swap(attrs[key] as string) as never;
        const variable = String(attrs.variable || "");
        if (
          attrs.step === "if" &&
          (variable === from || variable.startsWith(`${from}.`) || variable === `${from}_status`)
        )
          attrs.variable = to + variable.slice(from.length);
        return {
          ...step,
          attrs,
          content: step.content.map((piece) =>
            piece.type === "text" && piece.text ? { ...piece, text: swap(piece.text) } : piece,
          ),
        };
      }),
    })),
  };
}

/** Renames a section and keeps every "jump to" pointing at it. */
export function renameSection(model: PlaybookModel, sectionId: string, title: string): PlaybookModel {
  const old = model.sections.find((s) => s.id === sectionId)?.title ?? "";
  const stillUsed = model.sections.some((s) => s.id !== sectionId && s.title === old);
  return {
    ...model,
    sections: model.sections.map((section) => ({
      ...(section.id === sectionId ? { ...section, title } : section),
      steps: (section.id === sectionId ? { ...section, title } : section).steps.map((step) => {
        if (!old || stillUsed || !title.trim()) return step;
        const attrs = { ...step.attrs };
        if (attrs.then === old) attrs.then = title;
        if (attrs.else === old) attrs.else = title;
        return attrs.then === step.attrs.then && attrs.else === step.attrs.else ? step : { ...step, attrs };
      }),
    })),
  };
}

export const stepText = (step: BuilderStep) => textOf(step.content);
