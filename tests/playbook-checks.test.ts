import { describe, expect, it } from "vitest";
import { PROCEDURE_TEMPLATES, templateMarkdown } from "../src/lib/procedures";
import { parsePlaybook, newStep, renameSection, type PlaybookModel } from "../src/lib/playbook-model";
import { checkPlaybook } from "../src/lib/playbook-checks";

const messages = (model: PlaybookModel) => {
  const checks = checkPlaybook(model);
  return [...checks.steps.values(), ...checks.sections.values()].flat().map((i) => i.message);
};

describe("playbook checks", () => {
  it("finds nothing wrong with the templates", () => {
    for (const template of PROCEDURE_TEMPLATES) {
      const checks = checkPlaybook(parsePlaybook(templateMarkdown(template)));
      expect(checks.total, `${template.name}: ${messages(parsePlaybook(templateMarkdown(template))).join(" / ")}`).toBe(0);
    }
  });

  it("spots the usual slips, in plain words", () => {
    const model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
    // A decision with nothing chosen, an empty Say, a call with no address, a missing value.
    const decide = newStep("if");
    const say = newStep("send");
    const call = newStep("api");
    const typo = { ...newStep("send"), content: [{ type: "text", text: "Refund {{order_totl}}" }] };
    model.sections[0].steps.push(decide, say, call, typo);
    const found = messages(model);
    expect(found).toContain("Choose which value to check.");
    expect(found).toContain("Say what to compare it with.");
    expect(found).toContain("Write what to say or do.");
    expect(found).toContain("Add the web address to call.");
    expect(found).toContain("It uses “order_totl”, but there's no input or answer with that name.");
  });

  it("flags jumps to deleted sections and sections nothing leads to", () => {
    let model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
    // Delete "Escalate": two steps now jump nowhere.
    model = { ...model, sections: model.sections.filter((s) => s.title !== "Escalate") };
    expect(messages(model).filter((m) => m.includes("“Escalate”, which isn't a section"))).toHaveLength(2);
    // Point the eligibility decision's "otherwise" at the next step: store credit is unreachable.
    model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
    model.sections[0].steps[0].attrs.else = "";
    const checks = checkPlaybook(model);
    const credit = model.sections.find((s) => s.title === "Offer store credit")!;
    expect(checks.sections.get(credit.id)?.[0].message).toMatch(/Nothing leads here/);
    // Renaming keeps jumps working, so no warnings appear.
    model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
    model = renameSection(model, model.sections.find((s) => s.title === "Escalate")!.id, "Hand off");
    expect(checkPlaybook(model).total).toBe(0);
  });

  it("suggests ending with a Finish step", () => {
    const model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-blank")!));
    model.sections.at(-1)!.steps.pop();
    expect(messages(model)).toContain("Runs stop after this step. End with a Finish step to say how it ended.");
  });
});
