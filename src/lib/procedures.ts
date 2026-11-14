/**
 * Playbooks and runbooks: pages that start from a structured template.
 *
 * A playbook (in Ada's sense) is a procedure split into phases; each step says what kind
 * of move it is — Ask, Send, Run, If/Else, Hand off, End — so a person or an AI agent can
 * follow it. A runbook is a fixed, repeatable operation: owner and review date up top,
 * prerequisites, numbered steps with the result to expect, then verify, roll back and
 * escalate. Both are plain Markdown, so they read the same in either editor mode.
 */
import { END, NEXT, parseProcedure, type Param, type StepAttrs, type StepType } from "./runner";

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
  /** Automations call other apps or write notes for you; shown under their own heading. */
  group?: "automation";
};

export const PROCEDURE_KINDS: Record<ProcedureKind, { label: string; plural: string; blurb: string }> = {
  playbook: {
    label: "Playbook",
    plural: "Playbooks",
    blurb: "A step-by-step guide for handling a situation, like a refund or a late order. Press Run to be walked through it.",
  },
  runbook: {
    label: "Runbook",
    plural: "Runbooks",
    blurb: "A checklist for a task you do the same way every time, like a release or a backup, with a way back if something fails.",
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
const call = (
  text: string,
  method: StepOptions["method"],
  url: string,
  variable: string,
  onFail: string,
  extra: { headers?: string; body?: string } = {},
) => step("api", text, { method, url, variable, ...extra, ...(onFail ? { else: onFail } : {}) });
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
      "## Understand the request",
      ask("What does {{customer_name}} need help with?", "request"),
      "## Resolve",
      send("Thanks {{customer_name}} — here's what I've done: …"),
      "## Wrap up",
      ask("Is there anything else?", "anything_else", "yesno"),
      when("anything_else", "is", "Yes", "Understand the request", NEXT),
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
      "## Check eligibility",
      when("days_since_delivery", "lt", "31", NEXT, "Offer store credit", "Refunds are allowed within 30 days of delivery."),
      "## Refund",
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
      "## Send a code",
      send("Send a one-time code to {{customer_email}}."),
      ask("What code did the customer give?", "code"),
      check("Compare {{code}} with the code that was sent.", "The codes match", "Not verified"),
      "## Verified",
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
      "## Check the order",
      when("days_late", "gt", "5", "Late order", NEXT),
      "## On its way",
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
  /* ---------- Automations: notes that write themselves, and calls to other apps ---------- */
  {
    id: "playbook-standup",
    kind: "playbook",
    group: "automation",
    name: "Daily standup note",
    summary: "Three questions; saved as a note, shared if you like",
    whenToUse: "When to use: every morning. Your answers are saved as today's note in Runs, and can be posted to your team's chat.",
    icon: "icon:notebook:blue",
    markdown: lines(
      params([
        { name: "your_name", type: "text", required: true },
        { name: "team_webhook", label: "Team chat webhook (optional)", type: "text", required: false },
      ]),
      "## Guidelines",
      "- Keep each answer to a sentence or two.\n- Name people and tickets, so the note is easy to search later.",
      "## Write the note",
      ask("What did you get done yesterday?", "yesterday"),
      ask("What are you working on today?", "today"),
      ask("Is anything blocking you?", "blockers"),
      when("team_webhook", "set", "", "Share with the team", "Done", "Shared only if you gave a team chat webhook."),
      "## Share with the team",
      call("Post the note to your team's chat", "POST", "{{team_webhook}}", "post", "Done", {
        body: '{ "text": "{{your_name}}: yesterday {{yesterday}} · today {{today}} · blockers {{blockers}}" }',
      }),
      "## Done",
      end("Standup note saved"),
    ),
  },
  {
    id: "playbook-meeting-tasks",
    kind: "playbook",
    group: "automation",
    name: "Meeting notes to tasks",
    summary: "Capture decisions and send follow-ups to your task app",
    whenToUse: "When to use: right after a meeting. The notes are saved in Runs, and the action items go to your task tool's API.",
    icon: "icon:presentation:purple",
    markdown: lines(
      params([
        { name: "meeting", type: "text", required: true },
        { name: "tasks_api", label: "Task app API address (optional)", type: "text", required: false },
        { name: "api_token", label: "API token (optional)", type: "secret", required: false },
      ]),
      "## Guidelines",
      "- Write one action item per line, starting with who owns it.\n- Decisions are what was agreed, not what was discussed.",
      "## Capture",
      ask("Who was there?", "attendees"),
      ask("What was decided?", "decisions"),
      ask("What are the action items? One per line, with an owner.", "action_items"),
      when("tasks_api", "set", "", "Create tasks", "Done"),
      "## Create tasks",
      call("Create a follow-up task", "POST", "{{tasks_api}}", "task", "Tasks by hand", {
        headers: "Authorization: Bearer {{api_token}}\nAccept: application/json",
        body: '{ "title": "Follow-ups from {{meeting}}", "description": "{{action_items}}" }',
      }),
      send("Created a task for the follow-ups from {{meeting}}."),
      end("Notes saved and tasks created"),
      "## Tasks by hand",
      send("The task app didn't accept it. Copy these into it by hand: {{action_items}}"),
      end("Notes saved; tasks added by hand"),
      "## Done",
      end("Notes saved"),
    ),
  },
  {
    id: "playbook-github-issue",
    kind: "playbook",
    group: "automation",
    name: "Check a GitHub issue",
    summary: "Look up an issue live and say where it stands",
    whenToUse: "When to use: someone asks about a bug or feature request that's tracked on GitHub.",
    icon: "icon:code:purple",
    markdown: lines(
      params([
        { name: "owner", label: "Repository owner", type: "text", required: true, default: "vercel" },
        { name: "repo", label: "Repository", type: "text", required: true, default: "next.js" },
        { name: "issue_number", label: "Issue number", type: "number", required: true },
      ]),
      "## Look it up",
      call("Look up the issue on GitHub", "GET", "https://api.github.com/repos/{{owner}}/{{repo}}/issues/{{issue_number}}", "issue", "Not found", {
        headers: "Accept: application/vnd.github+json",
      }),
      when("issue.state", "is", "open", NEXT, "Closed"),
      "## Open",
      send("“{{issue.title}}” is still open. {{issue.user.login}} opened it, and it has {{issue.comments}} comments."),
      end("Issue is open"),
      "## Closed",
      send("“{{issue.title}}” was closed on {{issue.closed_at}}."),
      end("Issue is closed"),
      "## Not found",
      send("GitHub couldn't find issue {{issue_number}} in {{owner}}/{{repo}}."),
      end("Issue not found"),
    ),
  },
  {
    id: "runbook-uptime",
    kind: "runbook",
    group: "automation",
    name: "Check a site is up",
    summary: "Load the site, and alert the team if it's down",
    whenToUse: "When to use: someone reports the site is down, or as a quick check after a change.",
    icon: "icon:activity:green",
    markdown: lines(
      reviewTable("On-call engineer", "2 min"),
      params([
        { name: "site_url", label: "Site address", type: "text", required: true, default: "https://example.com" },
        { name: "alert_webhook", label: "Alert webhook (optional)", type: "text", required: false },
      ]),
      "## Check",
      call("Load the site", "GET", "{{site_url}}", "site", "Down"),
      when("site_status", "is", "200", NEXT, "Down", "Anything other than 200 OK counts as down."),
      "## Up",
      end("Site is up"),
      "## Down",
      check(
        "Open {{site_url}} in a browser to confirm it's down. (Some sites can't be checked from the local demo, so they land here too.)",
        "The page doesn't load, or shows an error",
      ),
      when("alert_webhook", "set", "", NEXT, END),
      call("Alert the team", "POST", "{{alert_webhook}}", "alert", "", {
        body: '{ "text": "{{site_url}} looks down (status {{site_status}})." }',
      }),
      end("Team alerted"),
    ),
  },
  {
    id: "runbook-weather",
    kind: "runbook",
    group: "automation",
    name: "Weather check before a site visit",
    summary: "Live forecast, with a plan for rain or wind",
    whenToUse: "When to use: before heading out to work on site.",
    icon: "icon:sun:yellow",
    markdown: lines(
      reviewTable("Site lead", "5 min"),
      params([
        { name: "place", label: "Where", type: "text", required: true, default: "London" },
        { name: "latitude", type: "number", required: true, default: "51.51" },
        { name: "longitude", type: "number", required: true, default: "-0.13" },
      ]),
      "## Forecast",
      call(
        "Get the current weather",
        "GET",
        "https://api.open-meteo.com/v1/forecast?latitude={{latitude}}&longitude={{longitude}}&current=temperature_2m,precipitation,wind_speed_10m",
        "weather",
        "No forecast",
      ),
      send("Right now in {{place}}: {{weather.current.temperature_2m}}°C, {{weather.current.precipitation}} mm of rain, wind {{weather.current.wind_speed_10m}} km/h."),
      when("weather.current.precipitation", "gt", "0", "Rain plan", NEXT),
      when("weather.current.wind_speed_10m", "gt", "40", "High wind plan", NEXT),
      end("Good to go"),
      "## Rain plan",
      check("Pack waterproofs and cover any equipment.", "Everything that can't get wet is covered"),
      end("Going, with rain gear"),
      "## High wind plan",
      check("Put off any work at height and tell the team.", "Work at height is rescheduled"),
      end("Going, without work at height"),
      "## No forecast",
      send("The weather service didn't answer. Check a forecast site before you leave."),
      end("Checked the forecast by hand"),
    ),
  },
  {
    id: "runbook-webhook",
    kind: "runbook",
    group: "automation",
    name: "Send a webhook",
    summary: "Post a message to any webhook and confirm it arrived",
    whenToUse: "When to use: to notify a chat channel or another app at a set point in a process.",
    icon: "icon:zap:orange",
    markdown: lines(
      reviewTable("Add an owner", "1 min"),
      params([
        { name: "webhook_url", label: "Webhook address", type: "text", required: true },
        { name: "message", type: "text", required: true },
      ]),
      "## Send",
      call("Send the message", "POST", "{{webhook_url}}", "reply", "Not sent", {
        body: '{ "text": "{{message}}" }',
      }),
      check("Confirm the message arrived.", "You can see it where the webhook posts"),
      end("Sent"),
      "## Not sent",
      send("The webhook answered {{reply_status}}. Check the address and try again."),
      end("Not sent"),
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
  // Only a lone {today}: a value called {{today}} in a step stays as it is.
  return template.markdown.replace(/(?<!\{)\{today\}(?!\})/g, localDate(today));
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
