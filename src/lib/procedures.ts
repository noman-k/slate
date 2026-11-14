/**
 * Playbooks and runbooks: pages that start from a structured template.
 *
 * A playbook (in Ada's sense) is a procedure split into phases; each step says what kind
 * of move it is — Ask, Send, Run, If/Else, Hand off, End — so a person or an AI agent can
 * follow it. A runbook is a fixed, repeatable operation: owner and review date up top,
 * prerequisites, numbered steps with the result to expect, then verify, roll back and
 * escalate. Both are plain Markdown, so they read the same in either editor mode.
 */
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
    blurb: "A guided procedure in phases, with each step marked Ask, Send, Run, If or Hand off.",
  },
  runbook: {
    label: "Runbook",
    plural: "Runbooks",
    blurb: "A repeatable operation: prerequisites, steps with expected results, verify and roll back.",
  },
};

const playbookIcon = "icon:compass:blue";
const runbookIcon = "icon:clipboard:orange";

export const PROCEDURE_TEMPLATES: ProcedureTemplate[] = [
  {
    id: "playbook-blank",
    kind: "playbook",
    name: "Blank playbook",
    summary: "Guidelines and three phases",
    whenToUse: "When to use: describe the situation this playbook handles.",
    icon: playbookIcon,
    markdown: `## Guidelines

- Keep a calm, friendly tone and use the customer's name.
- Never promise what the policy doesn't allow.

## 1 · Understand the request

1. **Ask** what they need help with, if it isn't clear yet.
2. **If** the request is out of scope → **Hand off** to a teammate.

## 2 · Resolve

1. **Run** the action that solves it.
2. **Send** a short confirmation of what changed.

## 3 · Wrap up

1. **Ask** if there's anything else.
2. **End** the playbook.
`,
  },
  {
    id: "playbook-refund",
    kind: "playbook",
    name: "Refund request",
    summary: "Check eligibility, refund or hand off",
    whenToUse: "When to use: a customer asks for their money back on an order.",
    icon: "icon:receipt:green",
    markdown: `## Guidelines

- Apologize once, then focus on solving it.
- Refunds go back to the original payment method only.
- Never ask for full card numbers.

## 1 · Find the order

1. **Ask** for the order number, or the email used at checkout.
2. **Run** *Look up order*.
3. **If** no order is found → **Send** "I couldn't find that order — could you double-check the number?" and repeat step 1 (twice at most), **else** continue.

## 2 · Check eligibility

1. **If** the order was delivered within 30 days → continue to *Refund*.
2. **Else** → **Send** the refund policy and offer store credit instead.
3. **If** the customer disputes the policy → **Hand off** to Billing.

## 3 · Refund

1. **Ask** for the reason (damaged, wrong item, changed mind, other).
2. **Run** *Issue refund* for the order total.
3. **Send** "Your refund is on its way — it can take 5–10 business days to appear."

## 4 · Wrap up

1. **Ask** if there's anything else.
2. **End** the playbook.
`,
  },
  {
    id: "playbook-verify",
    kind: "playbook",
    name: "Verify identity",
    summary: "Confirm who you're talking to first",
    whenToUse: "When to use: before changing account details or sharing private information.",
    icon: "icon:shield:purple",
    markdown: `## Guidelines

- Ask for one piece of information at a time.
- Don't reveal which detail was wrong.
- After three failed attempts, stop and hand off.

## 1 · Collect details

1. **Ask** for the email on the account.
2. **Run** *Send one-time code* to that email.
3. **Ask** for the 6-digit code.

## 2 · Check

1. **If** the code matches → **Send** "Thanks, you're verified." and continue.
2. **Else** → **Send** "That code didn't work — let's try again." and go back to step 1.2.
3. **If** three attempts fail → **Hand off** to Account security.

## 3 · Continue

1. **Run** the playbook the customer came for.
2. **End** the playbook.
`,
  },
  {
    id: "playbook-order-status",
    kind: "playbook",
    name: "Order status",
    summary: "Track a delivery and set expectations",
    whenToUse: "When to use: a customer asks where their order is.",
    icon: "icon:truck:brown",
    markdown: `## Guidelines

- Share dates, not guesses.
- If a delivery is late, say so plainly and offer the next step.

## 1 · Find the order

1. **Ask** for the order number.
2. **Run** *Look up order*.

## 2 · Share the status

1. **If** it's in transit → **Send** the carrier, tracking link and expected date.
2. **If** it's more than 5 days late → **Send** an apology and offer a replacement.
3. **If** it shows delivered but wasn't received → **Hand off** to Shipping.

## 3 · Wrap up

1. **Ask** if there's anything else.
2. **End** the playbook.
`,
  },
  {
    id: "runbook-blank",
    kind: "runbook",
    name: "Blank runbook",
    summary: "Owner, steps, verify, roll back",
    whenToUse: "When to use: describe the task this runbook performs.",
    icon: runbookIcon,
    markdown: `| Owner | Time needed | Last reviewed | Review every |
| --- | --- | --- | --- |
| Add an owner | 15 min | {today} | 90 days |

## Before you start

- [ ] You have access to the systems you'll change.
- [ ] You've told the team you're starting.

## Steps

1. Describe the first step.
   - *Expected:* what you should see when it worked.
2. Describe the next step.
   - *Expected:* what you should see when it worked.

## Verify

- [ ] Check that the change did what it should.

## Roll back

1. Undo the change if verification fails.

## Escalate

- If you're stuck for more than 15 minutes, contact the owner.
`,
  },
  {
    id: "runbook-incident",
    kind: "runbook",
    name: "Incident response",
    summary: "Triage, mitigate, communicate, review",
    whenToUse: "When to use: something customers rely on is down or badly degraded.",
    icon: "icon:flame:red",
    markdown: `| Owner | Time needed | Last reviewed | Review every |
| --- | --- | --- | --- |
| On-call engineer | Until resolved | {today} | 90 days |

## Before you start

- [ ] Open an incident channel and post the link here.
- [ ] Name an incident lead and a communications lead.

## Steps

1. Confirm the impact: who is affected, since when, how badly.
   - *Expected:* a one-line impact summary posted in the channel.
2. Set the severity (SEV1 customers blocked, SEV2 degraded, SEV3 minor).
   - *Expected:* severity recorded on the incident.
3. Post a status page update.
   - *Expected:* customers see that you're investigating.
4. Mitigate first: roll back the latest change, fail over, or scale up.
   - *Expected:* error rates and latency return to normal.
5. Update the status page every 30 minutes until resolved.

## Verify

- [ ] Dashboards are back to their normal range for 15 minutes.
- [ ] Support confirms new reports have stopped.

## Roll back

1. If a mitigation makes things worse, undo it before trying the next one.

## Escalate

- SEV1 not mitigated in 30 minutes: page the engineering manager.
- Data loss or a security concern: page the security on-call now.

## Afterwards

- [ ] Write a blameless review within 3 days.
- [ ] Turn follow-ups into tasks with owners.
`,
  },
  {
    id: "runbook-deploy",
    kind: "runbook",
    name: "Deploy a release",
    summary: "Ship safely with checks and a way back",
    whenToUse: "When to use: shipping a new version to production.",
    icon: "icon:rocket:purple",
    markdown: `| Owner | Time needed | Last reviewed | Review every |
| --- | --- | --- | --- |
| Release manager | 30 min | {today} | 90 days |

## Before you start

- [ ] All checks pass on the release branch.
- [ ] Release notes are written.
- [ ] No other deploy is in progress.

## Steps

1. Announce the deploy in the team channel.
   - *Expected:* no one objects within 5 minutes.
2. Deploy to staging and run the smoke tests.
   - *Expected:* all smoke tests pass.
3. Deploy to production.
   - *Expected:* the new version shows on the health endpoint.
4. Watch errors and latency for 15 minutes.
   - *Expected:* no rise compared with before the deploy.

## Verify

- [ ] Sign-in, the main flows and payments work in production.
- [ ] Release notes are published.

## Roll back

1. Redeploy the previous version.
2. Confirm the old version shows on the health endpoint.
3. Post in the team channel that the release was rolled back, and why.

## Escalate

- Errors keep rising after a rollback: start the *Incident response* runbook.
`,
  },
  {
    id: "runbook-restore",
    kind: "runbook",
    name: "Restore from backup",
    summary: "Bring data back to a known good point",
    whenToUse: "When to use: data was lost or corrupted and needs restoring.",
    icon: "icon:archive:brown",
    markdown: `| Owner | Time needed | Last reviewed | Review every |
| --- | --- | --- | --- |
| Database owner | 1 hour | {today} | 90 days |

## Before you start

- [ ] Agree on the point in time to restore to.
- [ ] Pause anything that writes to the affected data.

## Steps

1. Find the newest backup from before the problem.
   - *Expected:* a backup with a timestamp before the incident.
2. Restore it to a separate copy first.
   - *Expected:* the copy starts and accepts connections.
3. Spot-check the copy against known records.
   - *Expected:* the records look right and nothing is missing.
4. Switch the app to the restored copy.
   - *Expected:* the app reads from the restored data.

## Verify

- [ ] Recent records are present up to the restore point.
- [ ] Writes are resumed and working.

## Roll back

1. Point the app back at the original database.

## Escalate

- The backup itself is missing or damaged: contact the infrastructure lead now.
`,
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

/** Sections (## headings) with how many steps or checks each holds, for the preview. */
export function templateOutline(template: ProcedureTemplate) {
  const sections: { title: string; items: number }[] = [];
  for (const line of template.markdown.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) sections.push({ title: heading[1], items: 0 });
    else if (sections.length && /^(\d+\.|- )/.test(line)) sections[sections.length - 1].items++;
  }
  return sections;
}
