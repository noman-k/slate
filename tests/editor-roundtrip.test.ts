import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import {
  createDocumentExtensions,
  parseDocument,
} from "../src/components/editor/extensions";
import { encodeDirective } from "../src/lib/markdown";

const extensions = createDocumentExtensions();
const manager = new MarkdownManager({
  extensions,
  markedOptions: { gfm: true },
});
const documentApi = { schema: getSchema(extensions), markdown: manager };

function roundTrip(source: string) {
  const first = parseDocument(documentApi, source);
  const markdown = manager.serialize(first);
  const second = parseDocument(documentApi, markdown);
  return { first, markdown, second };
}

describe("interactive editor / Markdown round-trip", () => {
  it("retains nested lists, task lists, tables, formatting and fenced code as real nodes", () => {
    const source =
      "## Notes\n\n**Bold** and *italic* with `inline code`.\n\n- Parent\n  - Child\n    1. Nested number\n\n- [ ] Open task\n- [x] Done task\n\n| Name | Value |\n| --- | --- |\n| First | 1 |\n\n````markdown\n```js\nconst example = 1;\n```\n````";
    const { first, second } = roundTrip(source);
    expect(first.content?.some((node) => node.type === "heading")).toBe(true);
    expect(first.content?.some((node) => node.type === "taskList")).toBe(true);
    expect(first.content?.some((node) => node.type === "table")).toBe(true);
    expect(first.content?.some((node) => node.type === "codeBlock")).toBe(true);
    expect(second).toEqual(first);
  });
  it("retains stable private attachment URLs without signing them into Markdown", () => {
    const path = "/api/attachments/00000000-0000-4000-8000-000000000001";
    const { first, second, markdown } = roundTrip(
      `![Payment receipt](${path})`,
    );
    expect(
      first.content?.some(
        (node) => node.type === "image" && node.attrs?.src === path,
      ),
    ).toBe(true);
    expect(second).toEqual(first);
    expect(markdown).toContain(path);
  });
  it("retains embedded database IDs, view IDs and nested page links", () => {
    const source = `Before\n\n${encodeDirective({ kind: "database", id: "ledger-db", viewId: "paid-view" })}\n\n${encodeDirective({ kind: "page", id: "child-page", title: "Child page" })}\n\nAfter`;
    const { first, second, markdown } = roundTrip(source);
    expect(second).toEqual(first);
    expect(markdown).toContain("ledger-db");
    expect(markdown).toContain("paid-view");
    expect(markdown).toContain("child-page");
  });
  it("keeps unsupported syntax in explicit preserved source nodes", () => {
    const raw = ":::future-block\nKeep **this** exactly.\n:::";
    const { first, second, markdown } = roundTrip(`Before\n\n${raw}\n\nAfter`);
    expect(
      first.content?.find((node) => node.type === "preservedSource")?.attrs
        ?.source,
    ).toBe(raw);
    expect(markdown).toContain(raw);
    expect(second).toEqual(first);
  });
  it("preserves multiline unknown HTML and comments including blank lines", () => {
    const raw = "<div>\n  <div>nested content</div>\n\n  More content\n</div>";
    const comment = "<!-- Keep this comment\n\nincluding its blank lines -->";
    const { first, second, markdown } = roundTrip(`${raw}\n\n${comment}`);
    expect(
      first.content
        ?.filter((node) => node.type === "preservedSource")
        .map((node) => node.attrs?.source),
    ).toEqual([raw, comment]);
    expect(second).toEqual(first);
    expect(markdown).toContain(raw);
    expect(markdown).toContain(comment);
  });
  it("doesn't add an empty paragraph between a table and the block after it on each save", () => {
    let markdown = `| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::slate-node ${JSON.stringify({ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] })}\n`;
    for (let i = 0; i < 3; i++) {
      const doc = parseDocument(documentApi, markdown);
      expect(doc.content?.map((node) => node.type)).toEqual(["table", "callout"]);
      markdown = manager.serialize(doc);
    }
  });
  it("retains nested callouts and collapsed toggles through source edits", () => {
    const node = {
      type: "toggle",
      attrs: { title: "Details", open: false },
      content: [
        {
          type: "callout",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Remember this" }],
            },
          ],
        },
      ],
    };
    const { first, second } = roundTrip(
      `:::slate-node ${JSON.stringify(node)}`,
    );
    expect(first.content?.[0].type).toBe("toggle");
    expect(second).toEqual(first);
  });
});
