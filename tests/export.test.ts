import { describe, expect, it } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import { exportFileName, pageMarkdown } from "../src/lib/export";
import { encodeDirective } from "../src/lib/markdown";
import { recordTitle } from "../src/lib/database";

const origin = "https://slate.example";

describe("Export Markdown", () => {
  it("exports a table page as a Markdown table of its rows", () => {
    const state = createSeedState();
    const md = pageMarkdown(state, SEED_IDS.ledger, origin);
    expect(md.startsWith("# Rent Ledger\n\n")).toBe(true);
    const lines = md.split("\n").filter((line) => line.startsWith("|"));
    const rows = state.records.filter((r) => r.database_id === SEED_IDS.database);
    // Header, divider, one line per row.
    expect(lines).toHaveLength(rows.length + 2);
    expect(lines[0]).toContain("Rent Entry");
    expect(lines[1]).toMatch(/^\| --- \|/);
    expect(md).toContain(recordTitle(rows[0], state));
    expect(md).not.toContain(":::slate");
  });

  it("exports a row's page with its properties, then its text", () => {
    const state = createSeedState();
    const record = state.records.find((r) => r.database_id === SEED_IDS.database)!;
    state.documents.push({ page_id: record.page_id, markdown: "Paid by e-transfer.", updated_at: "" });
    const md = pageMarkdown(state, record.page_id, origin);
    expect(md).toMatch(/^# .+\n\n- \*\*/);
    expect(md).toMatch(/- \*\*Amount Received:\*\* \$[\d,]+\.\d\d/);
    expect(md.trimEnd().endsWith("Paid by e-transfer.")).toBe(true);
  });

  it("turns a page's embeds, callouts and steps into plain Markdown", () => {
    const state = createSeedState();
    const callout = {
      type: "callout",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Watch out" }] }],
    };
    const step = (text: string) => ({
      type: "procedureStep",
      attrs: { step: "send" },
      content: [{ type: "text", text }],
    });
    state.documents.find((d) => d.page_id === SEED_IDS.hub)!.markdown = [
      "Intro",
      encodeDirective({ kind: "page", id: SEED_IDS.log }),
      encodeDirective({ kind: "database", id: SEED_IDS.database }),
      `:::slate-node ${JSON.stringify(callout)}`,
      `:::slate-node ${JSON.stringify(step("First"))}`,
      `:::slate-node ${JSON.stringify(step("Second"))}`,
    ].join("\n\n");
    const md = pageMarkdown(state, SEED_IDS.hub, origin);
    expect(md).toContain(`[Tenant Rent Log](${origin}/p/${SEED_IDS.log})`);
    expect(md).toContain("**Rent Ledger**\n\n| Rent Entry");
    expect(md).toContain("> Watch out");
    expect(md).toContain("- [ ] First\n- [ ] Second");
    expect(md).not.toContain(":::slate");
  });

  it("escapes table cells and leaves out an empty description", () => {
    const state = createSeedState();
    const ledger = state.pages.find((p) => p.id === SEED_IDS.ledger)!;
    ledger.description = "";
    const record = state.records.find((r) => r.database_id === SEED_IDS.database)!;
    const title = state.properties.find((p) => p.database_id === SEED_IDS.database && p.type === "title")!;
    record.values[title.id] = "A | B\nC";
    const md = pageMarkdown(state, SEED_IDS.ledger, origin);
    expect(md).toContain("A \\| B<br>C");
    expect(md).not.toContain("\n\n\n");
  });

  it("names the file after the page, without characters files can't have", () => {
    expect(exportFileName("Q3: Plan / Budget?")).toBe("Q3- Plan - Budget-.md");
    expect(exportFileName("  ")).toBe("Untitled.md");
  });
});
