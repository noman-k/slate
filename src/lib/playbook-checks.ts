/**
 * Checks for a playbook, in plain words — the kind of slips Ada's best practices warn
 * about: a decision with nothing to check, a jump to a section that's gone, a value that
 * doesn't exist, a step nothing leads to, a run that stops without a Finish step.
 *
 * "warning" means the run will likely go wrong; "tip" means it works, but could be clearer.
 */
import { END, VARIABLE_PATTERN, valuesOf, type Step } from "./runner";
import type { PlaybookModel } from "./playbook-model";
import { stepText } from "./playbook-model";

export interface Issue {
  level: "warning" | "tip";
  message: string;
}
export interface PlaybookChecks {
  steps: Map<string, Issue[]>;
  sections: Map<string, Issue[]>;
  /** Warnings and tips, all together. */
  total: number;
  warnings: number;
}

const WHAT_TO_WRITE: Partial<Record<string, string>> = {
  send: "Write what to say or do.",
  ask: "Write the question to ask.",
  check: "Write what to do, then what you should see.",
};

export function checkPlaybook(model: PlaybookModel): PlaybookChecks {
  const steps = new Map<string, Issue[]>();
  const sections = new Map<string, Issue[]>();
  const add = (map: Map<string, Issue[]>, key: string, issue: Issue) => map.set(key, [...(map.get(key) || []), issue]);

  const flat = model.sections.flatMap((section) => section.steps.map((step) => ({ section, step })));
  const values = valuesOf({
    params: model.params.filter((p) => p.name),
    steps: flat.map(({ step }) => step.attrs as unknown as Step),
  });
  const known = new Set(values.map((v) => v.key));
  const titles = model.sections.map((s) => s.title.trim());
  const sectionExists = (target: string) => titles.includes(target);
  const firstStepOf = (title: string) =>
    flat.findIndex(({ section }) => section.title.trim() === title && section.steps.length > 0);

  // Each step on its own.
  flat.forEach(({ step }) => {
    const a = step.attrs;
    const type = a.step;
    const text = stepText(step).trim();
    if (!text && WHAT_TO_WRITE[type]) add(steps, step.id, { level: "warning", message: WHAT_TO_WRITE[type]! });
    if (type === "ask" && !a.variable)
      add(steps, step.id, { level: "tip", message: "Give the answer a name, so later steps can use it." });
    if (type === "ask" && a.answer === "choice" && !String(a.options || "").trim())
      add(steps, step.id, { level: "warning", message: "Add the choices to pick from." });
    if (type === "if") {
      if (!a.variable) add(steps, step.id, { level: "warning", message: "Choose which value to check." });
      else if (!known.has(String(a.variable).split(".")[0]))
        add(steps, step.id, { level: "warning", message: `There's no value called “${a.variable}” any more.` });
      if (a.op !== "set" && a.op !== "not_set" && !String(a.value || "").trim())
        add(steps, step.id, { level: "warning", message: "Say what to compare it with." });
      if ((a.then || "") === (a.else || ""))
        add(steps, step.id, { level: "tip", message: "Both answers go the same way, so this decision changes nothing." });
    }
    if (type === "api" && !String(a.url || "").trim())
      add(steps, step.id, { level: "warning", message: "Add the web address to call." });
    for (const key of ["then", "else"] as const) {
      const target = String(a[key] || "");
      if (target && target !== END && !sectionExists(target))
        add(steps, step.id, { level: "warning", message: `It jumps to “${target}”, which isn't a section any more.` });
    }
    // Values used in the text or settings.
    const used = [text, a.url, a.headers, a.body, a.expected, a.value].filter(Boolean).join(" ");
    const missing = new Set<string>();
    for (const match of used.matchAll(VARIABLE_PATTERN)) if (!known.has(match[1])) missing.add(match[1]);
    for (const name of missing)
      add(steps, step.id, { level: "warning", message: `It uses “${name}”, but there's no input or answer with that name.` });
  });

  // Which steps a run can reach, following the order and every jump.
  const reached = new Set<number>();
  const queue = flat.length ? [0] : [];
  while (queue.length) {
    const index = queue.pop()!;
    if (index < 0 || index >= flat.length || reached.has(index)) continue;
    reached.add(index);
    const a = flat[index].step.attrs;
    const jump = (target: unknown) => {
      const t = String(target || "");
      if (!t) queue.push(index + 1);
      else if (t !== END) queue.push(firstStepOf(t));
    };
    if (a.step === "end") continue;
    if (a.step === "if") {
      jump(a.then);
      jump(a.else);
    } else {
      queue.push(index + 1);
      if (a.step === "check" || a.step === "api") jump(a.else);
    }
  }

  model.sections.forEach((section, index) => {
    if (!section.title.trim()) add(sections, section.id, { level: "warning", message: "Give this section a name." });
    else if (titles.indexOf(section.title.trim()) !== index)
      add(sections, section.id, { level: "warning", message: "Another section has the same name, so jumps to it are unclear." });
    if (!section.steps.length) {
      add(sections, section.id, { level: "tip", message: "This section has no steps yet." });
      return;
    }
    const first = flat.findIndex(({ step }) => step.id === section.steps[0].id);
    if (!reached.has(first))
      add(sections, section.id, {
        level: "warning",
        message: "Nothing leads here: no step continues or jumps to this section.",
      });
  });

  // A run that runs out of steps stops without saying how it ended.
  const last = flat[flat.length - 1];
  if (last && last.step.attrs.step !== "end" && reached.has(flat.length - 1))
    add(steps, last.step.id, { level: "tip", message: "Runs stop after this step. End with a Finish step to say how it ended." });

  let total = 0;
  let warnings = 0;
  for (const list of [...steps.values(), ...sections.values()])
    for (const issue of list) {
      total++;
      if (issue.level === "warning") warnings++;
    }
  return { steps, sections, total, warnings };
}
