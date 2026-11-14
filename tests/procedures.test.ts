import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { createDocumentExtensions, parseDocument } from "../src/components/editor/extensions";
import { PAGE_ICON_SET, parsePageIcon } from "../src/components/page-icon";
import { PROCEDURE_TEMPLATES, TEMPLATE_CATEGORIES, templateMarkdown, templateOutline, templatesInOrder } from "../src/lib/procedures";

const extensions = createDocumentExtensions();
const manager = new MarkdownManager({ extensions, markedOptions: { gfm: true } });
const api = { schema: getSchema(extensions), markdown: manager };

describe("playbook templates", () => {
  it("lists a blank playbook first, then templates grouped by category", () => {
    const list = templatesInOrder();
    expect(list[0].id).toBe("playbook-blank");
    const order = TEMPLATE_CATEGORIES.map((c) => c.id);
    const seen = list.map((t) => order.indexOf(t.category));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(list.map((t) => t.category))).toEqual(new Set(order));
  });

  it("uses icons that exist and dates runbook reviews", () => {
    for (const t of PROCEDURE_TEMPLATES) expect(parsePageIcon(t.icon).kind).toBe("icon");
    expect(Object.keys(PAGE_ICON_SET).length).toBeGreaterThan(0);
    // Late evening locally is still that day, whatever the UTC date is.
    const md = templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "runbook-deploy")!, new Date(2026, 10, 13, 23, 30));
    expect(md).toContain("| 2026-11-13 |");
    expect(md).not.toMatch(/(?<!\{)\{today\}(?!\})/);
    // A value named {{today}} in a step isn't touched.
    const standup = templateMarkdown(PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-standup")!);
    expect(standup).toContain("{{today}}");
  });

  it("outlines sections with their step counts", () => {
    const refund = PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!;
    expect(templateOutline(refund).map((s) => s.title)).toEqual([
      "Guidelines", "Check eligibility", "Refund", "Offer store credit", "Escalate",
    ]);
    expect(templateOutline(refund).map((s) => s.items)).toEqual([0, 1, 3, 5, 2]);
  });

  it("parses into real headings, lists, checklists and tables, and survives a round trip", () => {
    for (const t of PROCEDURE_TEMPLATES) {
      const doc = parseDocument(api, templateMarkdown(t));
      const types = new Set(doc.content?.map((n) => n.type));
      expect(types.has("heading")).toBe(true);
      expect(types.has("preserved") || types.has("preservedSource")).toBe(false);
      expect(types.has("procedureStep")).toBe(true);
      if (t.category === "operations") expect(types.has("table")).toBe(true);
      // Every branch goes somewhere real.
      const sections = new Set(doc.content?.filter((n) => n.type === "heading").map((n) => n.content?.map((c) => c.text).join("")));
      for (const n of doc.content || [])
        if (n.type === "procedureStep")
          for (const target of [n.attrs?.then, n.attrs?.else])
            if (target && target !== "@end") expect(sections.has(target)).toBe(true);
      expect(parseDocument(api, manager.serialize(doc))).toEqual(doc);
    }
  });
});
