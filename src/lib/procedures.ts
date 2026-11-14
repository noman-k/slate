/**
 * Playbooks and runbooks: pages that start from a structured template.
 *
 * A playbook (in Ada's sense) is a procedure split into phases; each step says what kind
 * of move it is — Ask, Send, Run, If/Else, Hand off, End — so a person or an AI agent can
 * follow it. A runbook is a fixed, repeatable operation: owner and review date up top,
 * prerequisites, numbered steps with the result to expect, then verify, roll back and
 * escalate. Both are plain Markdown, so they read the same in either editor mode.
 */
import { NEXT, parseProcedure, type Param, type StepAttrs, type StepType } from "./runner";

export type ProcedureKind = "playbook" | "runbook";

export type ProcedureTemplate = {
  id: string;
  kind: ProcedureKind;
  name: string;
  /** One line for the gallery list. */
  summary: string;
  /** Becomes the page description: when this procedure applies. */
  whenToUse: string;
  /** Stored page icon ("icon:<name>:<color>"). */
  icon: string;
  /** The page's Markdown; `{today}` becomes the date it's created. */
  markdown: string;
};

export const PROCEDURE_KINDS: Record<ProcedureKind, { label: string; plural: string; blurb: string }> = {
  playbook: {
    label: "Playbook",
    plural: "Playbooks",
    blurb: "A guided procedure you can run: inputs, then Send, Ask, Check and If steps in phases.",
  },
  runbook: {
    label: "Runbook",
    plural: "Runbooks",
    blurb: "A repeatable operation you can run: checks with expected results and a way to roll back.",
  },
};

const playbookIcon = "icon:compass:blue";
const runbookIcon = "icon:clipboard:orange";

/* Builders for the blocks a runnable page is made of (see lib/runner.ts). */
type StepOptions = Omit<StepAttrs, "step">;
const node = (value: object) => `:::slate-node ${JSON.stringify(value)}`;
const step = (type: StepType, text: string, attrs: StepOptions = {}) =>
  node({
    type: "procedureStep",
    attrs: { step: type, ...attrs },
    ...(text ? { content: [{ type: "text", text }] } : {}),
  });
const send = (text: string) => step("send", text);
const ask = (text: string, variable: string, answer: StepOptions["answer"] = "text", options?: string) =>
  step("ask", text, { variable, answer, ...(options ? { options } : {}) });
const check = (text: string, expected: string, onFail?: string) =>
  step("check", text, { expected, ...(onFail ? { else: onFail } : {}) });
const when = (variable: string, op: StepOptions["op"], value: string, then: string, otherwise: string, note = "") =>
  // An empty target means "the next step"; it's left out, as the editor saves it.
  step("if", note, {
    variable,
    op,
    ...(value ? { value } : {}),
    ...(then ? { then } : {}),
    ...(otherwise ? { else: otherwise } : {}),
  });
const end = (text: string) => step("end", text);
const params = (list: Param[]) => node({ type: "procedureParams", attrs: { params: list } });
const lines = (...parts: string[]) => parts.join("\n\n") + "\n";
const reviewTable = (owner: string, time: string) => `| Owner | Time needed | Last reviewed | Review every |
| --- | --- | --- | --- |
| ${owner} | ${time} | {today} | 90 days |`;

export const PROCEDURE_TEMPLATES: ProcedureTemplate[] = [
  {
    id: "playbook-blank",
    kind: "playbook",
    name: "Blank playbook",
    summary: "Inputs, guidelines and three phases",
    whenToUse: "When to use: describe the situation this playbook handles.",
    icon: playbookIcon,
    markdown: lines(
      params([{ name: "customer_name", type: "text", required: true }]),
      "## Guidelines",
      "- Keep a calm, friendly tone and use the customer's name.\n- Never promise what the policy doesn't allow.",
      "## 1 · Understand the request",
      ask("What does {{customer_name}} need help with?", "request"),
      "## 2 · Resolve",
      send("Thanks {{customer_name}} — here's what I've done: …"),
      "## 3 · Wrap up",
      ask("Is there anything else?", "anything_else", "yesno"),
      when("anything_else", "is", "Yes", "1 · Understand the request", NEXT),
      end("Resolved"),
    ),
  },
  {
    id: "playbook-refund",
    kind: "playbook",
    name: "Refund request",
    summary: "Check eligibility, refund or offer credit",
    whenToUse: "When to use: a customer asks for their money back on an order.",
    icon: "icon:receipt:green",
    markdown: lines(
      params([
        { name: "order_number", type: "text", required: true },
        { name: "order_total", type: "text", required: true },
        { name: "days_since_delivery", type: "number", required: true },
        { name: "reason", type: "choice", required: false, options: ["Damaged", "Wrong item", "Changed mind", "Other"] },
      ]),
      "## Guidelines",
      "- Apologize once, then focus on solving it.\n- Refunds go back to the original payment method only.\n- Never ask for full card numbers.",
      "## 1 · Check eligibility",
      when("days_since_delivery", "lt", "31", NEXT, "Offer store credit", "Refunds are allowed within 30 days of delivery."),
      "## 2 · Refund",
      check("Refund {{order_total}} for order {{order_number}} in the payments dashboard.", "The refund shows as pending on {{order_number}}", "Escalate"),
      send("Your refund of {{order_total}} is on its way — it can take 5–10 business days to appear."),
      end("Refunded"),
      "## Offer store credit",
      send("Order {{order_number}} is outside our 30-day refund window, but I can offer {{order_total}} in store credit instead."),
      ask("Does the customer accept store credit?", "accepts_credit", "yesno"),
      when("accepts_credit", "is", "Yes", NEXT, "Escalate"),
      send("Done — {{order_total}} in store credit is ready to use right away."),
      end("Store credit issued"),
      "## Escalate",
      send("Hand off to Billing: order {{order_number}}, {{order_total}}, reason: {{reason}}."),
      end("Handed off to Billing"),
    ),
  },
  {
    id: "playbook-verify",
    kind: "playbook",
    name: "Verify identity",
    summary: "Confirm who you're talking to first",
    whenToUse: "When to use: before changing account details or sharing private information.",
    icon: "icon:shield:purple",
    markdown: lines(
      params([{ name: "customer_email", type: "text", required: true }]),
      "## Guidelines",
      "- Ask for one piece of information at a time.\n- Don't reveal which detail was wrong.",
      "## 1 · Send a code",
      send("Send a one-time code to {{customer_email}}."),
      ask("What code did the customer give?", "code"),
      check("Compare {{code}} with the code that was sent.", "The codes match", "Not verified"),
      "## 2 · Verified",
      send("Thanks, you're verified — let's carry on."),
      end("Verified"),
      "## Not verified",
      send("That code didn't work, so I'll pass you to our account security team."),
      end("Not verified — handed off to Account security"),
    ),
  },
  {
    id: "playbook-order-status",
    kind: "playbook",
    name: "Order status",
    summary: "Track a delivery and set expectations",
    whenToUse: "When to use: a customer asks where their order is.",
    icon: "icon:truck:brown",
    markdown: lines(
      params([
        { name: "order_number", type: "text", required: true },
        { name: "days_late", type: "number", required: false, default: "0" },
      ]),
      "## Guidelines",
      "- Share dates, not guesses.\n- If a delivery is late, say so plainly and offer the next step.",
      "## 1 · Check the order",
      when("days_late", "gt", "5", "Late order", NEXT),
      "## 2 · On its way",
      send("Order {{order_number}} is on its way — here's the tracking link and the expected date."),
      end("Shared tracking"),
      "## Late order",
      send("I'm sorry — order {{order_number}} is {{days_late}} days late."),
      ask("Would the customer like a replacement sent?", "wants_replacement", "yesno"),
      when("wants_replacement", "is", "Yes", NEXT, "@end"),
      check("Create a replacement order for {{order_number}}.", "The replacement has an order number"),
      end("Replacement sent"),
    ),
  },
  {
    id: "runbook-blank",
    kind: "runbook",
    name: "Blank runbook",
    summary: "Checks with expected results, roll back",
    whenToUse: "When to use: describe the task this runbook performs.",
    icon: runbookIcon,
    markdown: lines(
      reviewTable("Add an owner", "15 min"),
      params([{ name: "environment", type: "choice", required: true, options: ["Staging", "Production"] }]),
      "## Before you start",
      check("Make sure you have access to {{environment}}.", "You can sign in and see the dashboard"),
      "## Steps",
      check("Describe the first step.", "What you should see when it worked", "Roll back"),
      check("Describe the next step.", "What you should see when it worked", "Roll back"),
      end("Done"),
      "## Roll back",
      send("Undo the change in {{environment}}."),
      end("Rolled back"),
    ),
  },
  {
    id: "runbook-incident",
    kind: "runbook",
    name: "Incident response",
    summary: "Triage, escalate, mitigate, verify",
    whenToUse: "When to use: something customers rely on is down or badly degraded.",
    icon: "icon:flame:red",
    markdown: lines(
      reviewTable("On-call engineer", "Until resolved"),
      params([
        { name: "service", type: "text", required: true },
        { name: "severity", type: "choice", required: true, options: ["SEV1", "SEV2", "SEV3"] },
        { name: "incident_channel", type: "text", required: false, default: "#incidents" },
      ]),
      "## Triage",
      check("Confirm the impact on {{service}}: who is affected, since when, how badly.", "A one-line impact summary posted in {{incident_channel}}"),
      send("Post a status page update: we're investigating problems with {{service}}."),
      when("severity", "is", "SEV1", NEXT, "Mitigate", "SEV1 means customers are blocked."),
      "## Escalate",
      send("Page the engineering manager: {{severity}} on {{service}} — join {{incident_channel}}."),
      "## Mitigate",
      check("Roll back the latest change to {{service}}, fail over or scale up.", "Errors and latency return to normal", "Escalate"),
      send("Update the status page every 30 minutes until it's resolved."),
      "## Verify",
      check("Watch the dashboards for 15 minutes.", "Everything stays in its normal range"),
      send("Post the all-clear in {{incident_channel}} and on the status page."),
      end("Resolved — write a blameless review within 3 days"),
    ),
  },
  {
    id: "runbook-deploy",
    kind: "runbook",
    name: "Deploy a release",
    summary: "Ship safely with checks and a way back",
    whenToUse: "When to use: shipping a new version to production.",
    icon: "icon:rocket:purple",
    markdown: lines(
      reviewTable("Release manager", "30 min"),
      params([
        { name: "version", type: "text", required: true },
        { name: "environment", type: "choice", required: true, default: "Production", options: ["Staging", "Production"] },
      ]),
      "## Before you start",
      check("Check that every test passes on the {{version}} release branch.", "All checks are green"),
      send("Announce in the team channel: deploying {{version}} to {{environment}}."),
      "## Deploy",
      check("Deploy {{version}} to staging and run the smoke tests.", "All smoke tests pass", "Roll back"),
      check("Deploy {{version}} to {{environment}}.", "{{version}} shows on the health endpoint", "Roll back"),
      check("Watch errors and latency for 15 minutes.", "No rise compared with before the deploy", "Roll back"),
      send("Publish the release notes for {{version}}."),
      end("Deployed {{version}}"),
      "## Roll back",
      check("Redeploy the previous version.", "The previous version shows on the health endpoint"),
      send("Post in the team channel that {{version}} was rolled back, and why."),
      end("Rolled back {{version}}"),
    ),
  },
  {
    id: "runbook-restore",
    kind: "runbook",
    name: "Restore from backup",
    summary: "Bring data back to a known good point",
    whenToUse: "When to use: data was lost or corrupted and needs restoring.",
    icon: "icon:archive:brown",
    markdown: lines(
      reviewTable("Database owner", "1 hour"),
      params([
        { name: "database", type: "text", required: true },
        { name: "restore_point", type: "date", required: true },
      ]),
      "## Before you start",
      check("Pause anything that writes to {{database}}.", "No new writes in the last minute"),
      "## Restore",
      check("Find the newest backup of {{database}} from before {{restore_point}}.", "A backup timestamped before the incident"),
      check("Restore it to a separate copy.", "The copy starts and accepts connections", "Roll back"),
      check("Spot-check the copy against known records.", "The records look right and nothing is missing", "Roll back"),
      check("Switch the app to the restored copy.", "The app reads from the restored data", "Roll back"),
      "## Verify",
      check("Resume writes and watch for errors.", "Writes succeed and the error rate is normal", "Roll back"),
      end("Restored {{database}} to {{restore_point}}"),
      "## Roll back",
      send("Point the app back at the original {{database}} and tell the team."),
      end("Rolled back"),
    ),
  },
];

export function templatesOf(kind: ProcedureKind) {
  return PROCEDURE_TEMPLATES.filter((t) => t.kind === kind);
}

/** A date as YYYY-MM-DD in the person's own time zone (not UTC). */
export function localDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The template's Markdown, ready for a new page. */
export function templateMarkdown(template: ProcedureTemplate, today = new Date()) {
  return template.markdown.replaceAll("{today}", localDate(today));
}

/** Sections (## headings) with how many steps each holds, for the preview. */
export function templateOutline(template: ProcedureTemplate) {
  const procedure = parseProcedure(template.markdown);
  return procedure.sections.map((title, index) => ({
    title,
    items: procedure.steps.filter((s) => s.section === index).length,
  }));
}

/** The inputs a template asks for when it runs. */
export const templateInputs = (template: ProcedureTemplate) =>
  parseProcedure(template.markdown).params;
