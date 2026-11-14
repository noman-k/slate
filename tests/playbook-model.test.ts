import { describe, expect, it } from "vitest";
import { PROCEDURE_TEMPLATES, templateMarkdown } from "../src/lib/procedures";
import { parsePlaybook, renameInModel, renameSection, serializePlaybook, stepText } from "../src/lib/playbook-model";
import { parseProcedure } from "../src/lib/runner";

describe("playbook builder model", () => {
  it("reads every template and writes it back unchanged", () => {
    for (const template of PROCEDURE_TEMPLATES) {
      const markdown = templateMarkdown(template, new Date(2026, 10, 14));
      const model = parsePlaybook(markdown);
      expect(model.notes).toBe("");
      expect(serializePlaybook(model)).toBe(markdown);
    }
  });

  it("splits a page into details, inputs, guidelines and sections", () => {
    const model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "runbook-deploy")!));
    expect(model.details).toMatchObject({ owner: "Release manager", time: "30 min", reviewEvery: "90 days" });
    expect(model.params.map((p) => p.name)).toEqual(["version", "environment"]);
    expect(model.sections.map((s) => [s.title, s.steps.length])).toEqual([
      ["Before you start", 2],
      ["Deploy", 5],
      ["Roll back", 3],
    ]);
    const refund = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
    expect(refund.guidelines[0]).toBe("Apologize once, then focus on solving it.");
    expect(stepText(refund.sections[1].steps[0])).toContain("{{order_total}}");
  });

  it("keeps anything that isn't structure as notes, and section descriptions", () => {
    const step = (text: string) => `:::slate-node ${JSON.stringify({ type: "procedureStep", attrs: { step: "send" }, content: [{ type: "text", text }] })}`;
    const markdown = ["Intro paragraph.", "## Prepare", "Get everything ready first.", step("Open the app"), "> A quote that was here", "```\ncode\n```"].join("\n\n");
    const model = parsePlaybook(markdown);
    expect(model.sections[0]).toMatchObject({ title: "Prepare", description: "Get everything ready first." });
    expect(model.notes).toContain("Intro paragraph.");
    expect(model.notes).toContain("> A quote that was here");
    expect(model.notes).toContain("```\ncode\n```");
    // And it still runs: the steps are where the runner expects them.
    expect(parseProcedure(serializePlaybook(model)).steps.map((s) => s.text)).toEqual(["Open the app"]);
  });

  it("renames values and sections everywhere they're used", () => {
    let model = parsePlaybook(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
    // The input itself is renamed by the caller; everything that uses it follows.
    model = renameInModel({ ...model, params: model.params.map((p) => (p.name === "order_total" ? { ...p, name: "amount" } : p)) }, "order_total", "amount");
    const md = serializePlaybook(model);
    expect(md).not.toContain("order_total");
    expect(md).toContain("{{amount}}");
    const escalate = model.sections.find((s) => s.title === "Escalate")!;
    model = renameSection(model, escalate.id, "Hand off");
    expect(serializePlaybook(model)).toContain('"else":"Hand off"');
    expect(serializePlaybook(model)).not.toContain('"Escalate"');
  });
});
