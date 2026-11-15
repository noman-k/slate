import { describe, expect, it } from "vitest";
import { PROCEDURE_TEMPLATES, templateMarkdown } from "../src/lib/procedures";
import {
  advance,
  back,
  evaluate,
  interpolate,
  parseProcedure,
  runLogMarkdown,
  startRun,
  variablesOf,
} from "../src/lib/runner";

const refund = parseProcedure(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!));
const deploy = parseProcedure(templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "runbook-deploy")!));

describe("running a playbook", () => {
  it("reads parameters, sections and steps from the Markdown", () => {
    expect(refund.params.map((p) => p.name)).toEqual(["order_number", "order_total", "days_since_delivery", "reason"]);
    expect(refund.sections).toEqual(["Guidelines", "Check eligibility", "Refund", "Offer store credit", "Escalate"]);
    expect(refund.steps[0]).toMatchObject({
      step: "if",
      variable: "days_since_delivery",
      op: "lt",
      value: "31",
      section: 1,
    });
    expect(variablesOf(refund)).toContain("accepts_credit");
  });

  it("fills in {{values}} and leaves unknown ones visible", () => {
    const run = startRun(refund, { order_number: "A-12", order_total: "$40" });
    expect(interpolate("Refund {{order_total}} for {{ order_number }} ({{nope}})", refund, run.vars)).toBe(
      "Refund $40 for A-12 ({{nope}})",
    );
  });

  it("takes the eligible path straight to the refund", () => {
    let run = startRun(refund, { order_number: "A-12", order_total: "$40", days_since_delivery: "12" });
    expect(evaluate(refund.steps[0], refund, run.vars).holds).toBe(true);
    run = advance(refund, run, { kind: "next" });
    expect(refund.steps[run.step].section).toBe(refund.sections.indexOf("Refund"));
    run = advance(refund, run, { kind: "check", result: "passed" });
    run = advance(refund, run, { kind: "next" });
    run = advance(refund, run, { kind: "next" });
    expect(run.status).toBe("done");
    expect(run.log.map((e) => e.result)).toEqual(["Yes → the next step", "Passed", undefined, undefined]);
  });

  it("branches to store credit, saves answers and can go back", () => {
    let run = startRun(refund, { order_number: "A-12", order_total: "$40", days_since_delivery: "45" });
    run = advance(refund, run, { kind: "next" });
    expect(refund.sections[refund.steps[run.step].section]).toBe("Offer store credit");
    run = advance(refund, run, { kind: "next" }); // send
    run = advance(refund, run, { kind: "answer", value: "No" });
    expect(run.vars.accepts_credit).toBe("No");
    const before = run;
    run = advance(refund, run, { kind: "next" }); // if → Escalate
    expect(refund.sections[refund.steps[run.step].section]).toBe("Escalate");
    run = back(run);
    expect(run.step).toBe(before.step);
    expect(run.log).toHaveLength(before.log.length);
  });

  it("goes to Roll back when a check fails", () => {
    let run = startRun(deploy, { version: "2.0", environment: "Production" });
    run = advance(deploy, run, { kind: "check", result: "passed" });
    run = advance(deploy, run, { kind: "next" });
    run = advance(deploy, run, { kind: "check", result: "failed" });
    expect(deploy.sections[deploy.steps[run.step].section]).toBe("Roll back");
    expect(runLogMarkdown(deploy, run)).toContain("→ Failed");
    expect(runLogMarkdown(deploy, run)).toContain("Deploy 2.0 to staging");
  });

  it("reads a record input through a lookup, including its properties", () => {
    const p = parseProcedure(
      `:::slate-node ${JSON.stringify({ type: "procedureParams", attrs: { params: [{ name: "tenant", type: "record", required: true, databaseId: "d" }] } })}\n\n:::slate-node ${JSON.stringify({ type: "procedureStep", attrs: { step: "send" }, content: [{ type: "text", text: "Email {{tenant.Email}} for {{tenant}}" }] })}\n`,
    );
    const run = startRun(p, { tenant: "rec-1" });
    const lookup = (_: unknown, value: string, property?: string) =>
      property ? "alex@example.com" : value === "rec-1" ? "Alex Morgan" : value;
    expect(interpolate(p.steps[0].text, p, run.vars, lookup)).toBe("Email alex@example.com for Alex Morgan");
  });
});
