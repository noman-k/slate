/**
 * Playbook templates: pages that start from a structured guide you can run.
 *
 * One kind of thing covers both a guided response (a refund: ask, decide, hand off) and
 * a fixed operation (a release: check each step, roll back if one fails). Templates are
 * grouped by what they're for instead. They're plain Markdown underneath (see
 * lib/playbook-model.ts), so runs, links and the source view all read them the same way.
 */
import { END, NEXT, parseProcedure, type Param, type StepAttrs, type StepType } from "./runner";

export type TemplateCategory = "start" | "property" | "support" | "operations" | "automation";
/** Gallery order and headings. */
export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "start", label: "Start fresh" },
  { id: "property", label: "Home & property" },
  { id: "support", label: "Support" },
  { id: "operations", label: "Operations" },
  { id: "automation", label: "Notes & automations" },
];

export type ProcedureTemplate = {
  id: string;
  category: TemplateCategory;
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

/** What a playbook is, in one line (the gallery's description). */
export const PLAYBOOK_BLURB =
  "A checklist you can run: go through it step by step, and every run is remembered.";
/** Shown first in the gallery; the rest are behind "More templates". */
export const FEATURED_CATEGORIES: TemplateCategory[] = ["start", "property"];

const playbookIcon = "icon:compass:blue";

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
const check = (text: string, expected = "", onFail?: string) =>
  step("check", text, { ...(expected ? { expected } : {}), ...(onFail ? { else: onFail } : {}) });
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
    category: "start",
    name: "Blank checklist",
    summary: "A list of things to do, in order",
    whenToUse: "When to use: describe when this checklist applies.",
    icon: playbookIcon,
    markdown: lines(
      "## Steps",
      check("The first thing to do"),
      check("The next thing to do"),
      check("The last thing to do"),
      end("All done"),
    ),
  },
  /* ---------- Home & property: for landlords and small property managers ---------- */
  {
    id: "property-monthly-rent",
    category: "property",
    name: "Monthly rent check",
    summary: "Match payments, then chase anyone who's behind",
    whenToUse: "When to use: at the start of each month, once rent is due.",
    icon: "icon:receipt:green",
    markdown: lines(
      params([{ name: "month", type: "text", required: true, default: "This month" }]),
      "## Check payments",
      check("Open the Rent Ledger and look at {{month}}.", "Every unit has an entry for {{month}}"),
      check("Match each payment against your bank statement.", "Every payment you received is marked"),
      ask("Did anyone pay late or less than they owe?", "anyone_behind", "yesno"),
      when("anyone_behind", "is", "Yes", "Chase late rent", NEXT),
      end("Everyone paid for {{month}}"),
      "## Chase late rent",
      send("Send a friendly reminder to each tenant who's behind, with the amount and the due date."),
      check("Note the reminder in their Rent Ledger entry.", "Each reminder has a date"),
      end("Reminders sent for {{month}}"),
    ),
  },
  {
    id: "property-move-in",
    category: "property",
    name: "Tenant move-in",
    summary: "Lease, deposit, keys and a record of the condition",
    whenToUse: "When to use: a new tenant is moving in.",
    icon: "icon:house:orange",
    markdown: lines(
      params([
        { name: "tenant_name", type: "text", required: true },
        { name: "unit", type: "text", required: true },
      ]),
      "## Before the move",
      check("Get the lease signed by {{tenant_name}}.", "You have a signed copy"),
      check("Collect the deposit and first month's rent.", "Both have arrived in your account"),
      ask("How much was the deposit?", "deposit", "number"),
      "## Move-in day",
      check("Walk through {{unit}} with {{tenant_name}} and take photos of every room.", "Photos are saved with the date"),
      check("Write down the meter readings.", "Gas, electricity and water are noted"),
      check("Hand over the keys.", "{{tenant_name}} has every key and fob"),
      "## Afterwards",
      check("Add {{tenant_name}} to Tenants and their first rent to the Rent Ledger."),
      end("{{tenant_name}} moved in to {{unit}}"),
    ),
  },
  {
    id: "property-move-out",
    category: "property",
    name: "Tenant move-out",
    summary: "Inspection, keys and the deposit back on time",
    whenToUse: "When to use: a tenant has given notice and is moving out.",
    icon: "icon:archive:brown",
    markdown: lines(
      params([
        { name: "tenant_name", type: "text", required: true },
        { name: "unit", type: "text", required: true },
      ]),
      "## Inspection",
      check("Walk through {{unit}} and compare it with the move-in photos.", "Any damage beyond normal wear is noted"),
      check("Write down the final meter readings.", "Gas, electricity and water are noted"),
      check("Collect every key and fob from {{tenant_name}}."),
      ask("Do you need to keep any of the deposit?", "deductions", "yesno"),
      when("deductions", "is", "Yes", "Deductions", NEXT),
      "## Return the deposit",
      check("Return the full deposit to {{tenant_name}}.", "The payment has gone out"),
      end("Deposit returned in full"),
      "## Deductions",
      send("Send {{tenant_name}} a list of the deductions, with photos and costs."),
      check("Return the rest of the deposit.", "The payment has gone out"),
      end("Deposit returned, with deductions explained"),
    ),
  },
  {
    id: "property-late-rent",
    category: "property",
    name: "Chase late rent",
    summary: "A friendly reminder first, a formal notice if needed",
    whenToUse: "When to use: a tenant's rent is overdue.",
    icon: "icon:bell:red",
    markdown: lines(
      params([
        { name: "tenant_name", type: "text", required: true },
        { name: "amount", type: "text", required: true },
        { name: "days_late", type: "number", required: true },
      ]),
      "## Decide how to follow up",
      when("days_late", "gt", "14", "Formal notice", NEXT, "Two weeks late or more needs a formal notice."),
      "## Friendly reminder",
      send("Hi {{tenant_name}}, just a reminder that {{amount}} in rent is now {{days_late}} days overdue. Could you let me know when to expect it?"),
      check("Note the reminder in the Rent Ledger.", "The entry has today's date"),
      end("Reminder sent"),
      "## Formal notice",
      send("Send {{tenant_name}} a written notice: {{amount}} is {{days_late}} days overdue, with the date it must be paid by."),
      check("Keep a copy of the notice.", "It's saved with the tenant's records"),
      check("Note the notice in the Rent Ledger."),
      end("Formal notice sent"),
    ),
  },
  {
    id: "property-tax-year",
    category: "property",
    name: "Year-end tax prep",
    summary: "Everything your accountant needs, in one go",
    whenToUse: "When to use: once a year, before your tax return is due.",
    icon: "icon:calculator:blue",
    markdown: lines(
      params([{ name: "tax_year", type: "text", required: true }]),
      "## Gather",
      check("Export the Rent Ledger for {{tax_year}}.", "A spreadsheet with every month"),
      check("Collect receipts for repairs and maintenance.", "One folder with every receipt"),
      check("Download the mortgage interest and insurance statements."),
      check("List any months a unit was empty."),
      "## Send",
      check("Send everything to your accountant.", "They've confirmed they have it all"),
      end("{{tax_year}} sent to the accountant"),
    ),
  },
  {
    id: "playbook-refund",
    category: "support",
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
    id: "runbook-incident",
    category: "operations",
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
    category: "operations",
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
    category: "operations",
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
    category: "automation",
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
    category: "automation",
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
    category: "automation",
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
    category: "operations",
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
        "Open {{site_url}} in a browser to confirm it's down.",
        "The page doesn't load, or shows an error",
      ),
      when("alert_webhook", "set", "", NEXT, END),
      call("Alert the team", "POST", "{{alert_webhook}}", "alert", "", {
        body: '{ "text": "{{site_url}} looks down (status {{site_status}})." }',
      }),
      end("Team alerted"),
    ),
  },
];

/** Every template, in gallery order (by category, then as listed). */
export function templatesInOrder() {
  const order = TEMPLATE_CATEGORIES.map((c) => c.id);
  return [...PROCEDURE_TEMPLATES].sort((x, y) => order.indexOf(x.category) - order.indexOf(y.category));
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
