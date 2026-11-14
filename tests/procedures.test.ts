import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { createDocumentExtensions, parseDocument } from "../src/components/editor/extensions";
import { PAGE_ICON_SET, parsePageIcon } from "../src/components/page-icon";
import { PROCEDURE_TEMPLATES, templateMarkdown, templateOutline, templatesOf } from "../src/lib/procedures";

const extensions = createDocumentExtensions();
const manager = new MarkdownManager({ extensions, markedOptions: { gfm: true } });
const api = { schema: getSchema(extensions), markdown: manager };

describe("playbook and runbook templates", () => {
  it("offers a blank template first for each kind", () => {
    expect(templatesOf("playbook")[0].id).toBe("playbook-blank");
    expect(templatesOf("runbook")[0].id).toBe("runbook-blank");
  });

  it("uses icons that exist and dates runbook reviews", () => {
    for (const t of PROCEDURE_TEMPLATES) expect(parsePageIcon(t.icon).kind).toBe("icon");
    expect(Object.keys(PAGE_ICON_SET).length).toBeGreaterThan(0);
    // Late evening locally is still that day, whatever the UTC date is.
    const md = templateMarkdown(templatesOf("runbook")[0], new Date(2026, 10, 13, 23, 30));
    expect(md).toContain("| 2026-11-13 |");
    expect(md).not.toContain("{today}");
  });

  it("outlines sections with their step counts", () => {
    const refund = PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!;
    expect(templateOutline(refund).map((s) => s.title)).toEqual([
      "Guidelines", "1 · Find the order", "2 · Check eligibility", "3 · Refund", "4 · Wrap up",
    ]);
    expect(templateOutline(refund)[1].items).toBe(3);
  });

  it("parses into real headings, lists, checklists and tables, and survives a round trip", () => {
    for (const t of PROCEDURE_TEMPLATES) {
      const doc = parseDocument(api, templateMarkdown(t));
      const types = new Set(doc.content?.map((n) => n.type));
      expect(types.has("heading")).toBe(true);
      expect(types.has("preserved") || types.has("preservedSource")).toBe(false);
      if (t.kind === "runbook") {
        expect(types.has("table")).toBe(true);
        expect(types.has("taskList")).toBe(true);
      }
      expect(parseDocument(api, manager.serialize(doc))).toEqual(doc);
    }
  });
});
